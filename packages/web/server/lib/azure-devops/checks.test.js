import { describe, expect, it } from 'bun:test';

import {
  loadAzureDevOpsChecks,
  mapAzureBuildState,
  mapAzurePolicyStatus,
  mapAzurePrStatusState,
} from './checks.js';

describe('Azure DevOps checks mapping', () => {
  it('maps policy, build, and PR statuses into summary and runs', async () => {
    const client = {
      request: async (path) => {
        if (path.includes('/_apis/git/policy/evaluations')) {
          return {
            value: [
              {
                evaluationId: 11,
                status: 'approved',
                evaluationPolicyConfig: { type: { displayName: 'Required reviewers' } },
              },
              {
                evaluationId: 12,
                status: 'running',
                evaluationPolicyConfig: { type: { displayName: 'Work item linking' } },
              },
            ],
          };
        }
        if (path.includes('/_apis/build/builds')) {
          return {
            value: [
              {
                id: 99,
                status: 'completed',
                result: 'failed',
                definition: { name: 'CI Pipeline' },
                buildNumber: '2026.06.04.1',
              },
            ],
          };
        }
        if (path.includes('/pullrequests/') && path.includes('/statuses')) {
          return {
            value: [
              {
                state: 'succeeded',
                description: 'External quality gate passed',
                context: { name: 'Sonar', genre: 'quality' },
                targetUrl: 'https://example.test/check',
              },
            ],
          };
        }
        return { value: [] };
      },
    };

    const result = await loadAzureDevOpsChecks({
      client,
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
      pullRequestId: 42,
    });

    expect(result.checks).toEqual({
      state: 'failure',
      total: 4,
      success: 2,
      failure: 1,
      pending: 1,
    });
    expect(result.canMerge).toBe(false);
    expect(result.checkRuns).toHaveLength(4);
    expect(result.checkRuns.map((run) => run.name)).toEqual([
      'Required reviewers',
      'Work item linking',
      'CI Pipeline',
      'Sonar',
    ]);
  });

  it('maps raw Azure states conservatively', () => {
    expect(mapAzurePolicyStatus('approved')).toBe('success');
    expect(mapAzurePolicyStatus('broken')).toBe('failure');
    expect(mapAzurePolicyStatus('running')).toBe('pending');
    expect(mapAzureBuildState({ status: 'inProgress', result: 'succeeded' })).toBe('pending');
    expect(mapAzureBuildState({ status: 'completed', result: 'succeeded' })).toBe('success');
    expect(mapAzurePrStatusState({ state: 'error' })).toBe('failure');
    expect(mapAzurePrStatusState({ state: 'notSet' })).toBe('pending');
  });
});
