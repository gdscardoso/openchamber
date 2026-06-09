import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { toast } from '@/components/ui';
import { Icon } from "@/components/icon/Icon";
import { cn } from '@/lib/utils';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import { useAzureDevOpsAuthStore } from '@/stores/useAzureDevOpsAuthStore';
import { useGitHubAuthStore } from '@/stores/useGitHubAuthStore';
import { renderMagicPrompt } from '@/lib/magicPrompts';
import { useDeviceInfo } from '@/lib/device';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { GitHubPullRequestContextResult, GitHubPullRequestSummary, GitHubPullRequestsListResult, GitHubRepoSelector, GitProviderId, GitRemote } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';

const parsePrNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/pull\/(\d+)(?:\b|\/|$)/i);
  if (urlMatch) {
    const parsed = Number(urlMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const hashMatch = trimmed.match(/^#?(\d+)$/);
  if (hashMatch) {
    const parsed = Number(hashMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
};

const buildPullRequestContextText = (provider: GitProviderId, payload: GitHubPullRequestContextResult) => {
  const heading = provider === 'azure-devops'
    ? 'Azure DevOps pull request context (JSON)'
    : 'GitHub pull request context (JSON)';
  return `${heading}\n${JSON.stringify(payload, null, 2)}`;
};

const isAzureDevOpsRemote = (remote: GitRemote | null | undefined): boolean => {
  const url = `${remote?.fetchUrl || ''} ${remote?.pushUrl || ''}`.toLowerCase();
  return url.includes('dev.azure.com') || url.includes('visualstudio.com') || url.includes('ssh.dev.azure.com');
};

export function GitHubPrPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (pr: {
    number: number;
    title: string;
    url: string;
    head: string;
    base: string;
    includeDiff: boolean;
    instructionsText: string;
    contextText: string;
    author?: { login: string; avatarUrl?: string };
  }) => void;
}) {
  const { t } = useI18n();
  const { github, azureDevOps, git } = useRuntimeAPIs();
  const githubAuthStatus = useGitHubAuthStore((state) => state.status);
  const githubAuthChecked = useGitHubAuthStore((state) => state.hasChecked);
  const azureDevOpsAuthStatus = useAzureDevOpsAuthStore((state) => state.status);
  const azureDevOpsAuthChecked = useAzureDevOpsAuthStore((state) => state.hasChecked);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const isMobile = useUIStore((state) => state.isMobile);
  const { isTablet } = useDeviceInfo();
  const alwaysShowActions = isMobile || isTablet;
  const activeProject = useProjectsStore((state) => state.getActiveProject());
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);

  const projectDirectory = React.useMemo(() => {
    return activeProject?.path?.trim() || currentDirectory?.trim() || null;
  }, [activeProject?.path, currentDirectory]);

  const [query, setQuery] = React.useState('');
  const [includeDiff, setIncludeDiff] = React.useState(false);
  const [provider, setProvider] = React.useState<GitProviderId>('github');
  const [result, setResult] = React.useState<GitHubPullRequestsListResult | null>(null);
  const [prs, setPrs] = React.useState<GitHubPullRequestSummary[]>([]);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingPrNumber, setLoadingPrNumber] = React.useState<number | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const copyKey = React.useCallback((suffix: string) => {
    return `${provider === 'azure-devops' ? 'session.azureDevOpsPrPicker' : 'session.githubPrPicker'}.${suffix}`;
  }, [provider]);
  const tp = React.useCallback((suffix: string, values?: Record<string, string | number>) => {
    return t(copyKey(suffix) as never, values as never);
  }, [copyKey, t]);

  const resolveProvider = React.useCallback(async (): Promise<GitProviderId> => {
    if (!projectDirectory || !git?.getRemotes) {
      return 'github';
    }
    const remotes = await git.getRemotes(projectDirectory).catch(() => []);
    return remotes.some((remote) => isAzureDevOpsRemote(remote)) ? 'azure-devops' : 'github';
  }, [git, projectDirectory]);
  const directNumber = React.useMemo(() => parsePrNumber(query), [query]);
  const debouncedQuery = useDebouncedValue(query, 350);
  const isTextSearch = debouncedQuery.trim().length > 0 && !directNumber;

  const refresh = React.useCallback(async () => {
    if (!projectDirectory) {
      setResult(null);
      setError(tp('error.noActiveProject'));
      return;
    }
    const nextProvider = await resolveProvider();
    setProvider(nextProvider);
    const runtime = nextProvider === 'azure-devops' ? azureDevOps : github;
    const authChecked = nextProvider === 'azure-devops' ? azureDevOpsAuthChecked : githubAuthChecked;
    const authStatus = nextProvider === 'azure-devops' ? azureDevOpsAuthStatus : githubAuthStatus;
    if (authChecked && authStatus?.connected === false) {
      setResult({ connected: false });
      setPrs([]);
      setHasMore(false);
      setPage(1);
      setError(null);
      return;
    }
    if (!runtime?.prsList) {
      setResult(null);
      setError(tp('error.runtimeUnavailable'));
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const next = nextProvider === 'github' && isTextSearch
        ? await github!.prsList(projectDirectory, { page: 1, query: debouncedQuery.trim() })
        : await runtime.prsList(projectDirectory, { page: 1 });
      setResult(next);
      setPrs(next.prs ?? []);
      setPage(next.page ?? 1);
      setHasMore(Boolean(next.hasMore));
      if (next.connected === false) {
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [azureDevOps, azureDevOpsAuthChecked, azureDevOpsAuthStatus, debouncedQuery, github, githubAuthChecked, githubAuthStatus, isTextSearch, projectDirectory, resolveProvider, tp]);

  const loadMore = React.useCallback(async () => {
    if (!projectDirectory) return;
    if (isLoadingMore || isLoading) return;
    if (!hasMore) return;

    const runtime = provider === 'azure-devops' ? azureDevOps : github;
    if (!runtime?.prsList) return;

    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const next = provider === 'github' && isTextSearch
        ? await github!.prsList(projectDirectory, { page: nextPage, query: debouncedQuery.trim() })
        : await runtime.prsList(projectDirectory, { page: nextPage });
      setResult(next);
      setPrs((prev) => [...prev, ...(next.prs ?? [])]);
      setPage(next.page ?? nextPage);
      setHasMore(Boolean(next.hasMore));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(tp('toast.loadMoreFailed'), { description: message });
    } finally {
      setIsLoadingMore(false);
    }
  }, [azureDevOps, debouncedQuery, github, hasMore, isLoading, isLoadingMore, isTextSearch, page, projectDirectory, provider, tp]);

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setIncludeDiff(false);
      setLoadingPrNumber(null);
      setError(null);
      setResult(null);
      setPrs([]);
      setPage(1);
      setHasMore(false);
      setIsLoading(false);
      return;
    }
    void refresh();
  }, [open, refresh]);

  React.useEffect(() => {
    if (!open) return;
    const authChecked = provider === 'azure-devops' ? azureDevOpsAuthChecked : githubAuthChecked;
    const authStatus = provider === 'azure-devops' ? azureDevOpsAuthStatus : githubAuthStatus;
    if (authChecked && authStatus?.connected === false) {
      setResult({ connected: false });
      setPrs([]);
      setHasMore(false);
      setPage(1);
      setError(null);
    }
  }, [azureDevOpsAuthChecked, azureDevOpsAuthStatus, githubAuthChecked, githubAuthStatus, open, provider]);

  const authChecked = provider === 'azure-devops' ? azureDevOpsAuthChecked : githubAuthChecked;
  const connected = authChecked ? result?.connected !== false : true;
  const visiblePrs = React.useMemo(() => {
    if (provider !== 'azure-devops' || !query.trim() || directNumber) {
      return prs;
    }
    const normalizedQuery = query.trim().toLowerCase();
    return prs.filter((pr) => {
      if (String(pr.number) === normalizedQuery.replace(/^#/, '')) {
        return true;
      }
      return pr.title.toLowerCase().includes(normalizedQuery);
    });
  }, [directNumber, provider, prs, query]);

  const openProviderSettings = React.useCallback(() => {
    setSettingsPage('git');
    setSettingsDialogOpen(true);
  }, [setSettingsDialogOpen, setSettingsPage]);

  const attachPr = React.useCallback(async (prNumber: number, sourceRepo?: GitHubRepoSelector | null) => {
    if (!projectDirectory) {
      toast.error(t('session.githubPrPicker.error.noActiveProject'));
      return;
    }
    const runtime = provider === 'azure-devops' ? azureDevOps : github;
    if (!runtime?.prContext) {
      toast.error(tp('error.runtimeUnavailable'));
      return;
    }
    if (loadingPrNumber) return;

    setLoadingPrNumber(prNumber);
    try {
      const context = provider === 'azure-devops'
        ? await azureDevOps!.prContext(projectDirectory, prNumber, {
          includeDiff,
          includeCheckDetails: false,
        })
        : await github!.prContext(projectDirectory, prNumber, {
          includeDiff,
          includeCheckDetails: false,
          sourceRepo,
        });

      if (context.connected === false) {
        toast.error(tp('error.notConnected'));
        return;
      }

      if (!context.pr) {
        toast.error(tp('error.prNotFound'));
        return;
      }

      if (!context.repo) {
        toast.error(tp('error.repoNotResolvable'), {
          description: provider === 'azure-devops'
            ? tp('error.repoMustMatchProvider')
            : tp('error.repoMustBeGithub'),
        });
        return;
      }

      if (onSelect) {
        const instructionsText = await renderMagicPrompt('github.pr.review.instructions');
        onSelect({
          number: context.pr.number,
          title: context.pr.title,
          url: context.pr.url,
          head: context.pr.head,
          base: context.pr.base,
          includeDiff,
          instructionsText,
          contextText: buildPullRequestContextText(provider, context),
          author: context.pr.author
            ? {
              login: context.pr.author.login,
              avatarUrl: context.pr.author.avatarUrl,
            }
            : undefined,
        });
      }
      onOpenChange(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(tp('toast.loadDetailsFailed'), { description: message });
    } finally {
      setLoadingPrNumber(null);
    }
  }, [azureDevOps, github, includeDiff, loadingPrNumber, onOpenChange, onSelect, projectDirectory, provider, t, tp]);

  const runtime = provider === 'azure-devops' ? azureDevOps : github;
  const title = tp('title');
  const description = tp('description');

  const content = (
    <>
      <div className="mt-2 flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tp('searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 w-full"
          />
        </div>
        <button
          type="button"
          onClick={() => setIncludeDiff((prev) => !prev)}
          className="h-9 shrink-0 flex items-center gap-2 text-left"
          aria-pressed={includeDiff}
           aria-label={tp('includeDiffAria')}
        >
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={includeDiff}
              onChange={(checked) => setIncludeDiff(checked)}
              ariaLabel={tp('includeDiffAria')}
            />
          </span>
          <span className="typography-small text-muted-foreground whitespace-nowrap">{tp('includeDiff')}</span>
        </button>
      </div>

      <div className={cn(isMobile ? 'min-h-0' : 'flex-1 overflow-y-auto')}>
          {!projectDirectory ? (
            <div className="text-center text-muted-foreground py-8">{t('session.githubPrPicker.empty.noActiveProject')}</div>
          ) : null}

          {!runtime ? (
            <div className="text-center text-muted-foreground py-8">{tp('empty.runtimeUnavailable')}</div>
          ) : null}

          {isLoading ? (
            <div className="text-center text-muted-foreground py-8 flex items-center justify-center gap-2">
              <Icon name="loader-4" className="h-4 w-4 animate-spin" />
              {tp('loading.pullRequests')}
            </div>
          ) : null}

          {connected === false ? (
            <div className="text-center text-muted-foreground py-8 space-y-3">
              <div>{tp('empty.notConnected')}</div>
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={openProviderSettings}>
                  {tp('actions.openSettings')}
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="text-center text-muted-foreground py-8 break-words">{error}</div>
          ) : null}

          {directNumber && projectDirectory && runtime && connected ? (
            <div
              className={cn(
                'group flex items-center gap-2 py-1.5 hover:bg-interactive-hover/30 rounded transition-colors cursor-pointer',
                loadingPrNumber === directNumber && 'bg-interactive-selection/30'
              )}
              onClick={() => void attachPr(directNumber)}
            >
              <span className="typography-meta text-muted-foreground w-5 text-right flex-shrink-0">#</span>
              <p className="flex-1 min-w-0 typography-small text-foreground truncate ml-0.5">
                  {tp('actions.usePullRequest', { number: directNumber })}
                </p>
              <div className="flex-shrink-0 h-5 flex items-center mr-2">
                {loadingPrNumber === directNumber ? (
                  <Icon name="loader-4" className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
            </div>
          ) : null}

          {visiblePrs.length === 0 && !isLoading && connected && runtime && projectDirectory ? (
            <div className="text-center text-muted-foreground py-8">{query ? tp('empty.noPullRequestsFound') : tp('empty.noOpenPullRequestsFound')}</div>
          ) : null}

          {visiblePrs.map((pr) => (
            <div
              key={`${pr.sourceRepo?.owner ?? ''}-${pr.sourceRepo?.repo ?? ''}-${pr.number}`}
              className={cn(
                'group flex items-center gap-2 py-1.5 hover:bg-interactive-hover/30 rounded transition-colors cursor-pointer',
                loadingPrNumber === pr.number && 'bg-interactive-selection/30'
              )}
              onClick={() => void attachPr(pr.number, pr.sourceRepo)}
            >
              <div className="flex-1 min-w-0 ml-0.5">
                <p className="typography-small text-foreground truncate">
                  <span className="text-muted-foreground mr-1">#{pr.number}</span>
                  {pr.title}
                </p>
                {pr.sourceRepo?.source === 'upstream' ? (
                  <span className="typography-micro px-1 py-0.5 rounded bg-status-info/10 text-status-info">
                    {pr.sourceRepo.owner}/{pr.sourceRepo.repo}
                  </span>
                ) : null}
                <p className="typography-meta text-muted-foreground truncate">{pr.head} → {pr.base}</p>
              </div>

              <div className="flex-shrink-0 h-5 flex items-center mr-2">
                {loadingPrNumber === pr.number ? (
                  <Icon name="loader-4" className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground transition-colors",
                      alwaysShowActions ? "flex" : "hidden group-hover:flex"
                    )}
                    onClick={(e) => e.stopPropagation()}
                     aria-label={provider === 'azure-devops' ? tp('actions.openInProviderAria') : tp('actions.openInGitHubAria')}
                   >
                    <Icon name="external-link" className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          ))}

          {hasMore && connected && projectDirectory && runtime ? (
            <div className="py-2 flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore || Boolean(loadingPrNumber)}
                className={cn(
                  'typography-meta text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4',
                  (isLoadingMore || Boolean(loadingPrNumber)) && 'opacity-50 cursor-not-allowed hover:text-muted-foreground'
                )}
              >
                {isLoadingMore ? (
                  <span className="inline-flex items-center gap-2">
                    <Icon name="loader-4" className="h-4 w-4 animate-spin" />
                    {tp('loading.more')}
                  </span>
                ) : (
                  tp('actions.loadMore')
                )}
              </button>
            </div>
          ) : null}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <MobileOverlayPanel
        open={open}
        title={title}
        onClose={() => onOpenChange(false)}
        renderHeader={(closeButton) => (
          <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-border/40">
            <div className="flex items-center justify-between">
              <h2 className="typography-ui-label font-semibold text-foreground">{title}</h2>
              {closeButton}
            </div>
            <p className="typography-small text-muted-foreground">{description}</p>
          </div>
        )}
      >
        {content}
      </MobileOverlayPanel>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[70vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Icon name={provider === 'azure-devops' ? 'git-repository' : 'github'} className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>

        {content}
      </DialogContent>
    </Dialog>
  );
}
