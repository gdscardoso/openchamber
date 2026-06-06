import type {
  AzureDevOpsAPI,
  GitHubAPI,
  GitHubIssueCommentsResult,
  GitHubIssueGetResult,
  GitHubIssuesListResult,
  GitHubPullRequestContextResult,
  GitHubPullRequestsListResult,
  GitHubPullRequestStatus,
  GitProviderId,
} from '@/lib/api/types';

export type GitProviderApi = GitHubAPI | AzureDevOpsAPI;

export interface GitProviderAdapter {
  id: GitProviderId;
  label: string;
  prStatus(directory: string, branch: string, remote?: string, options?: { force?: boolean }): Promise<GitHubPullRequestStatus>;
  prList(directory: string, options?: { page?: number; remote?: string }): Promise<GitHubPullRequestsListResult>;
  prContext(
    directory: string,
    number: number,
    options?: { includeDiff?: boolean; includeCheckDetails?: boolean; sourceRepo?: unknown; remote?: string | null }
  ): Promise<GitHubPullRequestContextResult>;
  issuesList(directory: string, options?: { page?: number; remote?: string }): Promise<GitHubIssuesListResult>;
  issueGet(directory: string, number: number, options?: { sourceRepo?: unknown; remote?: string }): Promise<GitHubIssueGetResult>;
  issueComments(directory: string, number: number, options?: { sourceRepo?: unknown; remote?: string }): Promise<GitHubIssueCommentsResult>;
}
