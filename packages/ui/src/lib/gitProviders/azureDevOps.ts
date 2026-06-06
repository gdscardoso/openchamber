import type { AzureDevOpsAPI } from '@/lib/api/types';
import type { GitProviderAdapter } from './types';

export const createAzureDevOpsProviderAdapter = (api: AzureDevOpsAPI): GitProviderAdapter => ({
  id: 'azure-devops',
  label: 'Azure DevOps',
  prStatus: (directory, branch, remote, options) => api.prStatus(directory, branch, remote, options),
  prList: (directory, options) => api.prsList(directory, options),
  prContext: (directory, number, options) => api.prContext(directory, number, {
    includeDiff: options?.includeDiff,
    includeCheckDetails: options?.includeCheckDetails,
    remote: options?.remote,
  }),
  issuesList: (directory, options) => api.issuesList(directory, options),
  issueGet: (directory, number, options) => api.issueGet(directory, number, { remote: options?.remote }),
  issueComments: (directory, number, options) => api.issueComments(directory, number, { remote: options?.remote }),
});
