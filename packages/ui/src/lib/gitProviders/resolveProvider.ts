import type { GitProviderId, GitRemote } from '@/lib/api/types';

const AZURE_DEVOPS_HOST_PATTERNS = ['dev.azure.com', '.visualstudio.com', 'ssh.dev.azure.com'] as const;

export const isAzureDevOpsRemoteUrl = (remoteUrl: string): boolean => {
  const value = String(remoteUrl || '').trim().toLowerCase();
  if (!value) {
    return false;
  }
  return AZURE_DEVOPS_HOST_PATTERNS.some((pattern) => value.includes(pattern));
};

export const resolveProviderFromRemote = (remoteUrl: string): GitProviderId => {
  return isAzureDevOpsRemoteUrl(remoteUrl) ? 'azure-devops' : 'github';
};

export const resolveProviderFromRemotes = (remotes: GitRemote[], preferredRemoteName?: string | null): {
  provider: GitProviderId;
  remoteName: string | null;
} => {
  const preferredName = String(preferredRemoteName || '').trim();
  const ranked = preferredName
    ? [
        ...remotes.filter((remote) => remote.name === preferredName),
        ...remotes.filter((remote) => remote.name !== preferredName),
      ]
    : remotes;

  for (const remote of ranked) {
    const combinedUrl = `${remote.fetchUrl || ''} ${remote.pushUrl || ''}`;
    if (isAzureDevOpsRemoteUrl(combinedUrl)) {
      return { provider: 'azure-devops', remoteName: remote.name || null };
    }
  }

  const fallbackRemote = ranked[0]?.name ?? null;
  return { provider: 'github', remoteName: fallbackRemote };
};
