import type {
  AzureDevOpsAPI,
  AzureDevOpsAuthStatus,
  AzureDevOpsConnectInput,
  AzureDevOpsRepoUpstream,
  AzureDevOpsUserSummary,
  GitHubIssueCommentsResult,
  GitHubIssueGetResult,
  GitHubIssuesListResult,
  GitHubPullRequest,
  GitHubPullRequestContextResult,
  GitHubPullRequestCreateInput,
  GitHubPullRequestMergeInput,
  GitHubPullRequestMergeResult,
  GitHubPullRequestReadyInput,
  GitHubPullRequestReadyResult,
  GitHubPullRequestsListResult,
  GitHubPullRequestUpdateInput,
  GitHubPullRequestStatus,
} from '@openchamber/ui/lib/api/types';
import { runtimeFetch } from '@openchamber/ui/lib/runtime-fetch';

const jsonOrNull = async <T>(response: Response): Promise<T | null> => {
  return (await response.json().catch(() => null)) as T | null;
};

export const createWebAzureDevOpsAPI = (): AzureDevOpsAPI => ({
  async authStatus(): Promise<AzureDevOpsAuthStatus> {
    const response = await runtimeFetch('/api/azure-devops/auth/status', { method: 'GET', headers: { Accept: 'application/json' } });
    const payload = await jsonOrNull<AzureDevOpsAuthStatus & { error?: string }>(response);
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || 'Failed to load Azure DevOps status');
    }
    return payload;
  },

  async authConnect(input: AzureDevOpsConnectInput): Promise<AzureDevOpsAuthStatus> {
    const response = await runtimeFetch('/api/azure-devops/auth/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
    });
    const payload = await jsonOrNull<AzureDevOpsAuthStatus & { error?: string }>(response);
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || 'Failed to connect Azure DevOps');
    }
    return payload;
  },

  async authDisconnect(): Promise<{ removed: boolean }> {
    const response = await runtimeFetch('/api/azure-devops/auth', { method: 'DELETE', headers: { Accept: 'application/json' } });
    const payload = await jsonOrNull<{ removed?: boolean; error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload?.error || response.statusText || 'Failed to disconnect Azure DevOps');
    }
    return { removed: Boolean(payload?.removed) };
  },

  async authActivate(accountId: string): Promise<AzureDevOpsAuthStatus> {
    const response = await runtimeFetch('/api/azure-devops/auth/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    const payload = await jsonOrNull<AzureDevOpsAuthStatus & { error?: string }>(response);
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || 'Failed to activate Azure DevOps account');
    }
    return payload;
  },

  async me(): Promise<AzureDevOpsUserSummary> {
    const response = await runtimeFetch('/api/azure-devops/me', { method: 'GET', headers: { Accept: 'application/json' } });
    const payload = await jsonOrNull<AzureDevOpsUserSummary & { error?: string }>(response);
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || 'Failed to fetch Azure DevOps user');
    }
    return payload;
  },

  async prStatus(directory: string, branch: string, remote?: string, options?: { force?: boolean }): Promise<GitHubPullRequestStatus> {
    const params = new URLSearchParams({
      directory,
      branch,
      ...(remote ? { remote } : {}),
      ...(options?.force ? { force: 'true' } : {}),
    });
    const response = await runtimeFetch(`/api/azure-devops/pr/status?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const payload = await jsonOrNull<GitHubPullRequestStatus & { error?: string }>(response);
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || 'Failed to load Azure DevOps PR status');
    }
    return payload;
  },

  async prCreate(payload: GitHubPullRequestCreateInput): Promise<GitHubPullRequest> {
    const response = await runtimeFetch('/api/azure-devops/pr/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await jsonOrNull<GitHubPullRequest & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error((body as { error?: string } | null)?.error || response.statusText || 'Failed to create Azure DevOps PR');
    }
    return body;
  },

  async prUpdate(payload: GitHubPullRequestUpdateInput): Promise<GitHubPullRequest> {
    const response = await runtimeFetch('/api/azure-devops/pr/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await jsonOrNull<GitHubPullRequest & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error((body as { error?: string } | null)?.error || response.statusText || 'Failed to update Azure DevOps PR');
    }
    return body;
  },

  async prMerge(payload: GitHubPullRequestMergeInput): Promise<GitHubPullRequestMergeResult> {
    const response = await runtimeFetch('/api/azure-devops/pr/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await jsonOrNull<GitHubPullRequestMergeResult & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to complete Azure DevOps PR');
    }
    return body;
  },

  async prReady(payload: GitHubPullRequestReadyInput): Promise<GitHubPullRequestReadyResult> {
    const response = await runtimeFetch('/api/azure-devops/pr/ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await jsonOrNull<GitHubPullRequestReadyResult & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to mark Azure DevOps PR ready');
    }
    return body;
  },

  async prsList(directory: string, options?: { page?: number; remote?: string }): Promise<GitHubPullRequestsListResult> {
    const params = new URLSearchParams({ directory });
    if (options?.page) params.set('page', String(options.page));
    if (options?.remote) params.set('remote', options.remote);
    const response = await runtimeFetch(`/api/azure-devops/pulls/list?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = await jsonOrNull<GitHubPullRequestsListResult & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to list Azure DevOps pull requests');
    }
    return body;
  },

  async prContext(
    directory: string,
    number: number,
    options?: { includeDiff?: boolean; includeCheckDetails?: boolean; remote?: string | null }
  ): Promise<GitHubPullRequestContextResult> {
    const params = new URLSearchParams({ directory, number: String(number) });
    if (options?.includeDiff) params.set('diff', '1');
    if (options?.includeCheckDetails) params.set('checkDetails', '1');
    if (options?.remote) params.set('remote', options.remote);
    const response = await runtimeFetch(`/api/azure-devops/pulls/context?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = await jsonOrNull<GitHubPullRequestContextResult & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to load Azure DevOps pull request context');
    }
    return body;
  },

  async issuesList(directory: string, options?: { page?: number; remote?: string }): Promise<GitHubIssuesListResult> {
    const params = new URLSearchParams({ directory });
    if (options?.page) params.set('page', String(options.page));
    if (options?.remote) params.set('remote', options.remote);
    const response = await runtimeFetch(`/api/azure-devops/issues/list?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = await jsonOrNull<GitHubIssuesListResult & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to list Azure DevOps work items');
    }
    return body;
  },

  async issueGet(directory: string, number: number, options?: { remote?: string }): Promise<GitHubIssueGetResult> {
    const params = new URLSearchParams({ directory, number: String(number) });
    if (options?.remote) params.set('remote', options.remote);
    const response = await runtimeFetch(`/api/azure-devops/issues/get?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = await jsonOrNull<GitHubIssueGetResult & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to load Azure DevOps work item');
    }
    return body;
  },

  async issueComments(directory: string, number: number, options?: { remote?: string }): Promise<GitHubIssueCommentsResult> {
    const params = new URLSearchParams({ directory, number: String(number) });
    if (options?.remote) params.set('remote', options.remote);
    const response = await runtimeFetch(`/api/azure-devops/issues/comments?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = await jsonOrNull<GitHubIssueCommentsResult & { error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to load Azure DevOps work item comments');
    }
    return body;
  },

  async repoBranches(directory: string, remote?: string): Promise<string[]> {
    const params = new URLSearchParams({ directory });
    if (remote) params.set('remote', remote);
    const response = await runtimeFetch(`/api/azure-devops/repo/branches?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = await jsonOrNull<{ branches?: string[]; error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to fetch Azure DevOps repo branches');
    }
    return body.branches ?? [];
  },

  async repoUpstream(directory: string): Promise<{ connected: boolean; isFork: boolean; upstream: AzureDevOpsRepoUpstream | null }> {
    const params = new URLSearchParams({ directory });
    const response = await runtimeFetch(`/api/azure-devops/repo/upstream?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const body = await jsonOrNull<{ connected: boolean; isFork: boolean; upstream: AzureDevOpsRepoUpstream | null; error?: string }>(response);
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || 'Failed to detect Azure DevOps upstream repo');
    }
    return body;
  },
});
