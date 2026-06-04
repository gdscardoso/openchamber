import type {
  AzureDevOpsAPI,
  AzureDevOpsAuthStatus,
  AzureDevOpsConnectInput,
  AzureDevOpsUserSummary,
  GitHubPullRequest,
  GitHubPullRequestContextResult,
  GitHubPullRequestCreateInput,
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
});
