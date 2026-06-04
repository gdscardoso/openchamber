import { describe, expect, it } from 'vitest';
import { parseAzureDevOpsRemoteUrl } from './index.js';

describe('parseAzureDevOpsRemoteUrl', () => {
  it.each([
    ['https://dev.azure.com/org/project/_git/repo', { organization: 'org', project: 'project', repo: 'repo' }],
    ['https://dev.azure.com/verdecard/Automa%C3%A7%C3%B5es%20QQPAG/_git/GeracaoCenariosApp', { organization: 'verdecard', project: 'Automações QQPAG', repo: 'GeracaoCenariosApp' }],
    ['https://org@dev.azure.com/org/project/_git/repo', { organization: 'org', project: 'project', repo: 'repo' }],
    ['git@ssh.dev.azure.com:v3/org/project/repo', { organization: 'org', project: 'project', repo: 'repo' }],
    ['ssh://git@ssh.dev.azure.com/v3/org/project/repo', { organization: 'org', project: 'project', repo: 'repo' }],
    ['https://org.visualstudio.com/project/_git/repo', { organization: 'org', project: 'project', repo: 'repo' }],
    ['https://org.visualstudio.com/_git/repo', { organization: 'org', project: null, repo: 'repo' }],
  ])('parses %s', (remoteUrl, expected) => {
    expect(parseAzureDevOpsRemoteUrl(remoteUrl)).toMatchObject({
      provider: 'azure-devops',
      ...expected,
    });
  });

  it('returns null for non-Azure remotes', () => {
    expect(parseAzureDevOpsRemoteUrl('https://github.com/openchamber/openchamber')).toBeNull();
  });
});
