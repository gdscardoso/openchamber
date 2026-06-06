import type { GitHubAPI, GitHubRepoSelector } from '@/lib/api/types';
import type { GitProviderAdapter } from './types';

export const createGitHubProviderAdapter = (api: GitHubAPI): GitProviderAdapter => ({
  id: 'github',
  label: 'GitHub',
  prStatus: (directory, branch, remote, options) => api.prStatus(directory, branch, remote, options),
  prList: (directory, options) => api.prsList(directory, options ? { page: options.page } : undefined),
  prContext: (directory, number, options) => api.prContext(directory, number, {
    includeDiff: options?.includeDiff,
    includeCheckDetails: options?.includeCheckDetails,
    sourceRepo: (options?.sourceRepo as GitHubRepoSelector | null | undefined) ?? undefined,
    remote: options?.remote,
  }),
  issuesList: (directory, options) => api.issuesList(directory, options ? { page: options.page } : undefined),
  issueGet: (directory, number, options) => api.issueGet(directory, number, {
    sourceRepo: (options?.sourceRepo as GitHubRepoSelector | null | undefined) ?? undefined,
  }),
  issueComments: (directory, number, options) => api.issueComments(directory, number, {
    sourceRepo: (options?.sourceRepo as GitHubRepoSelector | null | undefined) ?? undefined,
  }),
});
