import { getRemotes, getStatus } from '../git/index.js';
import { normalizeAzureBranchRef } from './client.js';
import { resolveAzureDevOpsRepoFromDirectory } from './repo/index.js';

const normalizeText = (value) => typeof value === 'string' ? value.trim() : '';

const parseTrackingRemoteName = (trackingBranch) => {
  const normalized = normalizeText(trackingBranch);
  const slashIndex = normalized.indexOf('/');
  return slashIndex > 0 ? normalized.slice(0, slashIndex).trim() : '';
};

const pushUnique = (collection, value) => {
  const normalized = normalizeText(value);
  if (normalized && !collection.includes(normalized)) collection.push(normalized);
};

const rankRemoteNames = (remoteNames, explicitRemoteName, trackingRemoteName) => {
  const ranked = [];
  pushUnique(ranked, explicitRemoteName);
  pushUnique(ranked, trackingRemoteName);
  pushUnique(ranked, 'origin');
  pushUnique(ranked, 'upstream');
  remoteNames.forEach((name) => pushUnique(ranked, name));
  return ranked;
};

function mapPr(pr, repo) {
  const state = pr.status === 'completed' ? 'merged' : pr.status === 'abandoned' ? 'closed' : 'open';
  return {
    provider: 'azure-devops',
    number: pr.pullRequestId,
    title: pr.title || '',
    body: pr.description || '',
    url: pr.webUrl || `${repo.webUrl}/pullrequest/${pr.pullRequestId}`,
    state,
    draft: Boolean(pr.isDraft),
    base: normalizeText(pr.targetRefName).replace(/^refs\/heads\//, ''),
    head: normalizeText(pr.sourceRefName).replace(/^refs\/heads\//, ''),
    headSha: pr.lastMergeSourceCommit?.commitId || pr.lastMergeCommit?.commitId,
    mergeable: null,
    mergeableState: pr.mergeStatus || null,
  };
}

async function listPullRequests(client, repo, sourceRefName, status) {
  const data = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests`, {
    query: {
      'searchCriteria.sourceRefName': sourceRefName,
      'searchCriteria.status': status,
      '$top': 10,
    },
  });
  return Array.isArray(data?.value) ? data.value : [];
}

export async function resolveAzureDevOpsPrStatus({ client, directory, branch, remoteName = 'origin' }) {
  const status = await getStatus(directory).catch(() => null);
  const remotes = await getRemotes(directory).catch(() => []);
  const remoteNames = remotes.map((remote) => remote?.name).filter(Boolean);
  const rankedRemoteNames = rankRemoteNames(remoteNames, remoteName, parseTrackingRemoteName(status?.tracking));
  const sourceRefName = normalizeAzureBranchRef(branch);
  if (!sourceRefName) {
    return { connected: true, repo: null, branch, pr: null, checks: null, canMerge: false, defaultBranch: null, resolvedRemoteName: null };
  }

  for (const candidateRemoteName of rankedRemoteNames) {
    const { repo } = await resolveAzureDevOpsRepoFromDirectory(directory, candidateRemoteName, client).catch(() => ({ repo: null }));
    if (!repo?.project) continue;

    const resolvedRepo = repo.repositoryId ? repo : (await resolveAzureDevOpsRepoFromDirectory(directory, candidateRemoteName, client)).repo;
    if (!resolvedRepo?.repositoryId && !resolvedRepo?.repo) continue;

    let pulls = await listPullRequests(client, resolvedRepo, sourceRefName, 'active');
    if (!pulls.length) {
      pulls = [
        ...(await listPullRequests(client, resolvedRepo, sourceRefName, 'completed')),
        ...(await listPullRequests(client, resolvedRepo, sourceRefName, 'abandoned')),
      ];
    }
    const pr = pulls[0] ? mapPr(pulls[0], resolvedRepo) : null;
    return {
      connected: true,
      provider: 'azure-devops',
      repo: resolvedRepo,
      branch,
      pr,
      checks: null,
      canMerge: false,
      defaultBranch: normalizeText(resolvedRepo.defaultBranch).replace(/^refs\/heads\//, '') || null,
      resolvedRemoteName: candidateRemoteName,
    };
  }

  return { connected: true, provider: 'azure-devops', repo: null, branch, pr: null, checks: null, canMerge: false, defaultBranch: null, resolvedRemoteName: null };
}
