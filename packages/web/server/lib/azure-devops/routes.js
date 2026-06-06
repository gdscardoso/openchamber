import { loadAzureDevOpsChecks } from './checks.js';

const PR_STATUS_CACHE_TTL_MS = 90_000;
const PR_STATUS_CACHE_MAX_ENTRIES = 200;
const WORK_ITEMS_PAGE_SIZE = 50;
const prStatusCache = new Map();
const OPEN_WORK_ITEMS_WIQL = [
  'SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.ChangedDate]',
  'FROM WorkItems',
  "WHERE [System.TeamProject] = @project AND [System.State] <> 'Closed'",
  'ORDER BY [System.ChangedDate] DESC',
].join(' ');

function setPrStatusCache(key, data, fetchedAt) {
  if (prStatusCache.size >= PR_STATUS_CACHE_MAX_ENTRIES && !prStatusCache.has(key)) {
    const oldest = prStatusCache.entries().next().value;
    if (oldest) prStatusCache.delete(oldest[0]);
  }
  prStatusCache.set(key, { data, fetchedAt });
}

function normalizeBranchName(value) {
  return String(value || '').trim().replace(/^refs\/heads\//, '').replace(/^heads\//, '');
}

function normalizeOrganizationInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'dev.azure.com') {
      const organization = url.pathname.replace(/^\/+/, '').split('/')[0];
      return decodeURIComponent(organization || url.username || '').trim().toLowerCase();
    }
    if (hostname.endsWith('.visualstudio.com')) {
      return hostname.slice(0, -'.visualstudio.com'.length).trim().toLowerCase();
    }
  } catch {
    // Plain organization names are expected.
  }
  return raw.replace(/^dev\.azure\.com\//i, '').replace(/\.visualstudio\.com.*$/i, '').replace(/\/.*$/, '').trim().toLowerCase();
}

function mapProfileToUser(profile, organization) {
  if (!profile || typeof profile !== 'object') {
    return { login: organization, name: organization };
  }
  return {
    login: profile.coreAttributes?.['System.Account']?.value || profile.displayName || organization,
    id: profile.id,
    name: profile.displayName || organization,
    email: profile.emailAddress || profile.coreAttributes?.['System.Email']?.value || undefined,
  };
}

function mapPullRequest(pr, repo) {
  return {
    provider: 'azure-devops',
    number: pr.pullRequestId,
    title: pr.title || '',
    body: pr.description || '',
    url: pr.webUrl || `${repo.webUrl}/pullrequest/${pr.pullRequestId}`,
    state: pr.status === 'completed' ? 'merged' : pr.status === 'abandoned' ? 'closed' : 'open',
    draft: Boolean(pr.isDraft),
    base: normalizeBranchName(pr.targetRefName),
    head: normalizeBranchName(pr.sourceRefName),
    headSha: pr.lastMergeSourceCommit?.commitId || pr.lastMergeCommit?.commitId,
    mergeable: null,
    mergeableState: pr.mergeStatus || null,
  };
}

function mapAzureIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const login = identity.uniqueName || identity.displayName || identity.id;
  if (!login) return null;
  return {
    login,
    id: identity.id,
    name: identity.displayName || login,
    email: identity.uniqueName && String(identity.uniqueName).includes('@') ? identity.uniqueName : undefined,
    avatarUrl: identity._links?.avatar?.href,
  };
}

function mapAzureWorkItemState(state) {
  const normalized = String(state || '').trim().toLowerCase();
  if (normalized === 'closed' || normalized === 'done' || normalized === 'removed') {
    return 'closed';
  }
  return 'open';
}

function buildAzureWorkItemUrl(repo, id) {
  if (!repo?.organization || !repo?.project || !id) return '';
  return `https://dev.azure.com/${encodeURIComponent(repo.organization)}/${encodeURIComponent(repo.project)}/_workitems/edit/${encodeURIComponent(id)}`;
}

function normalizeAzureDefaultBranch(value) {
  return normalizeBranchName(String(value || '').trim() || 'main') || 'main';
}

async function resolveExplicitAzureRepo(client, targetRepo) {
  const organization = String(targetRepo?.organization || '').trim().toLowerCase();
  const project = typeof targetRepo?.project === 'string' ? targetRepo.project.trim() : '';
  const repo = typeof targetRepo?.repo === 'string' ? targetRepo.repo.trim() : '';
  const repositoryId = typeof targetRepo?.repositoryId === 'string' ? targetRepo.repositoryId.trim() : '';
  if (!organization || !project || !repo) {
    return null;
  }
  if (organization !== String(client?.auth?.organization || '').trim().toLowerCase()) {
    return null;
  }

  const metadata = await client.request(`/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId || repo)}`).catch(() => null);
  if (!metadata?.name) {
    return null;
  }

  return {
    provider: 'azure-devops',
    organization,
    project: metadata.project?.name || project,
    projectId: metadata.project?.id || null,
    repo: metadata.name || repo,
    repositoryId: metadata.id || repositoryId || undefined,
    url: metadata.remoteUrl || metadata.webUrl || '',
    webUrl: metadata.webUrl || '',
    defaultBranch: metadata.defaultBranch || null,
  };
}

async function listAzureRepoBranches(client, repo) {
  const branches = [];
  let continuationToken = null;

  while (true) {
    const response = await client.request(
      `/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/refs`,
      {
        query: {
          filter: 'heads/',
          ...(continuationToken ? { continuationToken } : {}),
        },
        includeHeaders: true,
      }
    );
    const page = Array.isArray(response?.data?.value) ? response.data.value : [];
    for (const ref of page) {
      const name = normalizeBranchName(ref?.name);
      if (name) {
        branches.push(name);
      }
    }
    continuationToken = response?.headers?.get('x-ms-continuationtoken') || null;
    if (!continuationToken) {
      break;
    }
  }

  return Array.from(new Set(branches));
}

async function findAzureRemoteNameForRepo({ directory, client, organization, project, repositoryId, repoName }) {
  const { resolveAzureDevOpsRepoFromDirectory } = await import('./index.js');
  const { getRemotes } = await import('../git/index.js');
  const remotes = await getRemotes(directory).catch(() => []);
  for (const remote of remotes) {
    if (!remote?.name) {
      continue;
    }
    const resolved = await resolveAzureDevOpsRepoFromDirectory(directory, remote.name, client).catch(() => ({ repo: null }));
    const candidate = resolved.repo;
    if (!candidate?.organization || !candidate?.repo) {
      continue;
    }
    if (String(candidate.organization).toLowerCase() !== String(organization).toLowerCase()) {
      continue;
    }
    if (String(candidate.project || '').toLowerCase() !== String(project || '').toLowerCase()) {
      continue;
    }
    if (repositoryId && candidate.repositoryId && String(candidate.repositoryId) === String(repositoryId)) {
      return remote.name;
    }
    if (String(candidate.repo).toLowerCase() === String(repoName).toLowerCase()) {
      return remote.name;
    }
  }
  return null;
}

async function mapAzureUpstreamRepo({ directory, client, parentRepository }) {
  if (!parentRepository?.name || !parentRepository?.project?.name) {
    return null;
  }

  const organization = String(client?.auth?.organization || '').trim().toLowerCase();
  const project = parentRepository.project.name || null;
  const repo = parentRepository.name;
  const repositoryId = parentRepository.id || undefined;
  const defaultBranch = normalizeAzureDefaultBranch(parentRepository.defaultBranch);
  const remoteName = await findAzureRemoteNameForRepo({
    directory,
    client,
    organization,
    project,
    repositoryId,
    repoName: repo,
  }).catch(() => null);

  return {
    organization,
    project,
    repo,
    repositoryId,
    url: parentRepository.webUrl || parentRepository.remoteUrl || '',
    defaultBranch,
    remoteName,
  };
}

function mapAzureWorkItemSummary(workItem, repo) {
  const fields = workItem?.fields || {};
  const workItemType = typeof fields['System.WorkItemType'] === 'string' ? fields['System.WorkItemType'].trim() : '';
  const assignedTo = mapAzureIdentity(fields['System.AssignedTo']);
  return {
    number: workItem?.id,
    title: typeof fields['System.Title'] === 'string' ? fields['System.Title'] : '',
    url: buildAzureWorkItemUrl(repo, workItem?.id),
    state: mapAzureWorkItemState(fields['System.State']),
    author: assignedTo,
    labels: workItemType ? [{ name: workItemType }] : [],
  };
}

function mapAzureWorkItem(workItem, repo) {
  const fields = workItem?.fields || {};
  const summary = mapAzureWorkItemSummary(workItem, repo);
  const assignedTo = mapAzureIdentity(fields['System.AssignedTo']);
  return {
    ...summary,
    body: typeof fields['System.Description'] === 'string' ? fields['System.Description'] : '',
    createdAt: fields['System.CreatedDate'] || undefined,
    updatedAt: fields['System.ChangedDate'] || undefined,
    assignees: assignedTo ? [assignedTo] : [],
  };
}

function mapAzureThreadComments(threads) {
  const issueComments = [];
  const reviewComments = [];
  for (const thread of Array.isArray(threads) ? threads : []) {
    const path = typeof thread?.threadContext?.filePath === 'string' ? thread.threadContext.filePath : '';
    const line = thread?.threadContext?.rightFileEnd?.line ?? thread?.threadContext?.rightFileStart?.line ?? null;
    for (const comment of Array.isArray(thread?.comments) ? thread.comments : []) {
      const body = typeof comment?.content === 'string' ? comment.content.trim() : '';
      if (!body || comment?.isDeleted) continue;
      const mapped = {
        id: Number(`${thread.id || 0}${String(comment.id || 0).padStart(4, '0')}`),
        url: '',
        body,
        author: mapAzureIdentity(comment.author),
        createdAt: comment.publishedDate || comment.lastUpdatedDate,
        updatedAt: comment.lastUpdatedDate || comment.publishedDate,
      };
      if (path) {
        reviewComments.push({
          ...mapped,
          path,
          line: typeof line === 'number' ? line : null,
          position: null,
        });
      } else {
        issueComments.push(mapped);
      }
    }
  }
  return { issueComments, reviewComments };
}

function mapAzureFileStatus(changeType) {
  switch (String(changeType || '').toLowerCase()) {
    case 'add':
    case 'undelete':
      return 'added';
    case 'edit':
      return 'modified';
    case 'delete':
      return 'removed';
    case 'rename':
    case 'sourcerename':
    case 'targetrename':
      return 'renamed';
    default:
      return String(changeType || '').trim().toLowerCase() || 'modified';
  }
}

function isAzureBlobChange(change) {
  return !Boolean(change?.item?.isFolder || String(change?.item?.gitObjectType || '').toLowerCase() === 'tree');
}

function mapAzurePullRequestFiles(changes) {
  return (Array.isArray(changes) ? changes : [])
    .filter(isAzureBlobChange)
    .map((change) => ({
      filename: change?.item?.path || change?.sourceServerItem || '',
      status: mapAzureFileStatus(change?.changeType),
      previousFilename: change?.originalPath || undefined,
      additions: undefined,
      deletions: undefined,
      changes: undefined,
      patch: typeof change?.newContent?.content === 'string' ? change.newContent.content : undefined,
    }))
    .filter((file) => file.filename);
}

function buildAzureSyntheticDiff({ pr, files }) {
  const lines = [
    `# Azure DevOps PR ${pr?.number || ''} diff summary`,
    `# Base: ${pr?.base || ''}`,
    `# Head: ${pr?.head || ''}`,
    `# Files changed: ${files.length}`,
    '',
  ];

  for (const file of files) {
    lines.push(`diff --azure ${file.status || 'modified'} ${file.filename}`);
    if (file.status === 'renamed' && file.previousFilename) {
      lines.push(`rename from ${file.previousFilename}`);
      lines.push(`rename to ${file.filename}`);
    } else {
      lines.push(`file ${file.filename}`);
    }
    if (file.patch) {
      lines.push('@@ azure-devops-content @@');
      lines.push(file.patch);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

async function listAzurePullRequestDiffChanges(client, repo, pullRequest) {
  const baseCommit = pullRequest?.lastMergeTargetCommit?.commitId;
  const targetCommit = pullRequest?.lastMergeSourceCommit?.commitId;
  if (!baseCommit || !targetCommit) {
    return [];
  }

  const basePath = `/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/diffs/commits`;
  const changes = [];
  let skip = 0;
  const top = 2000;

  while (true) {
    const payload = await client.request(basePath, {
      query: {
        baseVersion: baseCommit,
        baseVersionType: 'commit',
        targetVersion: targetCommit,
        targetVersionType: 'commit',
        '$top': top,
        '$skip': skip,
      },
    }).catch(() => null);
    const page = Array.isArray(payload?.changes) ? payload.changes : [];
    if (!page.length) {
      break;
    }
    changes.push(...page);
    if (payload?.allChangesIncluded === true || page.length < top) {
      break;
    }
    skip += page.length;
  }

  return changes;
}

async function listAzurePullRequestIterationChanges(client, repo, pullRequestId) {
  const basePath = `/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(pullRequestId)}`;
  const iterationsPayload = await client.request(`${basePath}/iterations`).catch(() => ({ value: [] }));
  const iterations = Array.isArray(iterationsPayload?.value) ? iterationsPayload.value : [];
  const latestIteration = iterations.reduce((latest, iteration) => {
    return !latest || Number(iteration?.id) > Number(latest?.id) ? iteration : latest;
  }, null);
  if (!latestIteration?.id) {
    return [];
  }

  const changes = [];
  let skip = 0;
  const top = 2000;

  while (true) {
    const payload = await client.request(`${basePath}/iterations/${encodeURIComponent(latestIteration.id)}/changes`, {
      query: {
        '$top': top,
        '$skip': skip,
      },
    }).catch(() => null);
    const page = Array.isArray(payload?.changeEntries) ? payload.changeEntries : [];
    if (!page.length) {
      break;
    }
    changes.push(...page);
    if (!payload?.nextSkip || page.length < top) {
      break;
    }
    skip = Number(payload.nextSkip) || skip + page.length;
  }

  return changes;
}

async function loadAzurePullRequestFilesAndDiff({ client, repo, pr, includeDiff }) {
  const diffChanges = await listAzurePullRequestDiffChanges(client, repo, pr);
  const fallbackChanges = diffChanges.length > 0 ? [] : await listAzurePullRequestIterationChanges(client, repo, pr.pullRequestId);
  const files = mapAzurePullRequestFiles(diffChanges.length > 0 ? diffChanges : fallbackChanges);
  const diff = includeDiff && files.length > 0 ? buildAzureSyntheticDiff({ pr: mapPullRequest(pr, repo), files }) : undefined;
  return { files, diff };
}

export function registerAzureDevOpsRoutes(app) {
  let libraries = null;
  const getLibraries = async () => {
    if (!libraries) libraries = await import('./index.js');
    return libraries;
  };

  const getClient = async () => {
    const { createAzureDevOpsClient } = await getLibraries();
    return createAzureDevOpsClient();
  };

  const resolveRepoForRequest = async (client, directory, remote = 'origin') => {
    const { resolveAzureDevOpsRepoFromDirectory } = await getLibraries();
    const { repo } = await resolveAzureDevOpsRepoFromDirectory(directory, remote, client);
    if (!repo?.project) return null;
    return repo;
  };

  app.get('/api/azure-devops/auth/status', async (_req, res) => {
    try {
      const { getAzureDevOpsAuth, getAzureDevOpsAuthAccounts, setAzureDevOpsAuth, clearAzureDevOpsAuth, isAzureDevOpsAuthInvalid } = await getLibraries();
      const auth = getAzureDevOpsAuth();
      const accounts = getAzureDevOpsAuthAccounts();
      if (!auth?.pat) {
        return res.json({ connected: false, accounts });
      }
      const client = await getClient();
      if (!client) {
        return res.json({ connected: false, accounts });
      }
      try {
        const profile = await client.getProfile();
        const user = mapProfileToUser(profile, auth.organization);
        setAzureDevOpsAuth({ ...auth, user });
        return res.json({ connected: true, organization: auth.organization, label: auth.label, user, accounts: getAzureDevOpsAuthAccounts() });
      } catch (error) {
        if (isAzureDevOpsAuthInvalid(error)) {
          clearAzureDevOpsAuth();
          return res.json({ connected: false, accounts: getAzureDevOpsAuthAccounts() });
        }
        return res.json({ connected: true, organization: auth.organization, label: auth.label, user: auth.user, accounts });
      }
    } catch (error) {
      console.error('Failed to get Azure DevOps auth status:', error);
      return res.status(500).json({ error: error.message || 'Failed to get Azure DevOps auth status' });
    }
  });

  app.post('/api/azure-devops/auth/connect', async (req, res) => {
    try {
      const organization = normalizeOrganizationInput(req.body?.organization);
      const pat = typeof req.body?.pat === 'string' ? req.body.pat : '';
      const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
      if (!organization || !pat) {
        return res.status(400).json({ error: 'organization and pat are required' });
      }
      const { setAzureDevOpsAuth, getAzureDevOpsAuthAccounts, createAzureDevOpsClient } = await getLibraries();
      const tempAuth = { organization, pat, label };
      const client = createAzureDevOpsClient(tempAuth);
      let user = { login: organization, name: organization };
      try {
        user = mapProfileToUser(await client.getProfile(), organization);
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          return res.status(401).json({ error: 'Azure DevOps PAT rejected' });
        }
      }
      const auth = setAzureDevOpsAuth({ organization, pat, label, user });
      return res.json({ connected: true, organization: auth.organization, label: auth.label, user, accounts: getAzureDevOpsAuthAccounts() });
    } catch (error) {
      console.error('Failed to connect Azure DevOps:', error);
      return res.status(500).json({ error: error.message || 'Failed to connect Azure DevOps' });
    }
  });

  app.post('/api/azure-devops/auth/activate', async (req, res) => {
    try {
      const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId.trim() : '';
      if (!accountId) return res.status(400).json({ error: 'accountId is required' });
      const { activateAzureDevOpsAuth, getAzureDevOpsAuth, getAzureDevOpsAuthAccounts } = await getLibraries();
      if (!activateAzureDevOpsAuth(accountId)) {
        return res.status(404).json({ error: 'Azure DevOps account not found' });
      }
      const auth = getAzureDevOpsAuth();
      return res.json({ connected: Boolean(auth?.pat), organization: auth?.organization, label: auth?.label, user: auth?.user, accounts: getAzureDevOpsAuthAccounts() });
    } catch (error) {
      console.error('Failed to activate Azure DevOps account:', error);
      return res.status(500).json({ error: error.message || 'Failed to activate Azure DevOps account' });
    }
  });

  app.delete('/api/azure-devops/auth', async (_req, res) => {
    try {
      const { clearAzureDevOpsAuth } = await getLibraries();
      return res.json({ success: true, removed: clearAzureDevOpsAuth() });
    } catch (error) {
      console.error('Failed to disconnect Azure DevOps:', error);
      return res.status(500).json({ error: error.message || 'Failed to disconnect Azure DevOps' });
    }
  });

  app.get('/api/azure-devops/me', async (_req, res) => {
    try {
      const client = await getClient();
      if (!client) return res.status(401).json({ error: 'Azure DevOps not connected' });
      return res.json(mapProfileToUser(await client.getProfile(), client.auth.organization));
    } catch (error) {
      console.error('Failed to fetch Azure DevOps user:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch Azure DevOps user' });
    }
  });

  app.get('/api/azure-devops/pr/status', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const branch = typeof req.query?.branch === 'string' ? req.query.branch.trim() : '';
      const remote = typeof req.query?.remote === 'string' ? req.query.remote.trim() : 'origin';
      const force = req.query?.force === 'true' || req.query?.force === '1';
      if (!directory || !branch) {
        return res.status(400).json({ error: 'directory and branch are required' });
      }
      const cacheKey = `${directory}::${branch}::${remote}`;
      const cached = prStatusCache.get(cacheKey);
      if (!force && cached && Date.now() - cached.fetchedAt < PR_STATUS_CACHE_TTL_MS) {
        return res.json(cached.data);
      }
      const client = await getClient();
      if (!client) return res.json({ connected: false, provider: 'azure-devops' });
      const { resolveAzureDevOpsPrStatus } = await import('./pr-status.js');
      const data = await resolveAzureDevOpsPrStatus({ client, directory, branch, remoteName: remote });
      if (data?.connected) setPrStatusCache(cacheKey, data, Date.now());
      return res.json(data);
    } catch (error) {
      console.error('Failed to load Azure DevOps PR status:', error);
      return res.status(500).json({ error: error.message || 'Failed to load Azure DevOps PR status' });
    }
  });

  app.post('/api/azure-devops/pr/create', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory.trim() : '';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const head = normalizeBranchName(req.body?.head);
      const base = normalizeBranchName(req.body?.base);
      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      const draft = Boolean(req.body?.draft);
      const remote = typeof req.body?.remote === 'string' ? req.body.remote.trim() : 'origin';
      const headRemote = typeof req.body?.headRemote === 'string' ? req.body.headRemote.trim() : '';
      const targetRepo = req.body?.targetRepo
        && typeof req.body.targetRepo.organization === 'string'
        && typeof req.body.targetRepo.repo === 'string'
        ? {
            organization: req.body.targetRepo.organization.trim(),
            project: typeof req.body.targetRepo.project === 'string' ? req.body.targetRepo.project.trim() : null,
            repo: req.body.targetRepo.repo.trim(),
            repositoryId: typeof req.body.targetRepo.repositoryId === 'string' ? req.body.targetRepo.repositoryId.trim() : undefined,
          }
        : null;
      if (!directory || !title || !head || !base) {
        return res.status(400).json({ error: 'directory, title, head, base are required' });
      }
      const client = await getClient();
      if (!client) return res.status(401).json({ error: 'Azure DevOps not connected' });
      const sourceRepo = await resolveRepoForRequest(client, directory, headRemote || 'origin');
      if (!sourceRepo?.project) {
        return res.status(400).json({ error: 'Unable to resolve Azure DevOps source repo from git remote' });
      }
      const repo = targetRepo
        ? await resolveExplicitAzureRepo(client, targetRepo)
        : await resolveRepoForRequest(client, directory, remote);
      if (!repo?.project) {
        return res.status(400).json({ error: 'Unable to resolve Azure DevOps repo from git remote' });
      }

      const isCrossRepo = Boolean(
        sourceRepo.repositoryId
        && repo.repositoryId
        && String(sourceRepo.repositoryId) !== String(repo.repositoryId),
      );
      const created = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests`, {
        method: 'POST',
        body: {
          sourceRefName: `refs/heads/${head}`,
          targetRefName: `refs/heads/${base}`,
          title,
          description: body,
          isDraft: draft,
          ...(isCrossRepo
            ? {
                forkSource: {
                  repository: {
                    id: sourceRepo.repositoryId,
                    name: sourceRepo.repo,
                    project: sourceRepo.project ? { name: sourceRepo.project, id: sourceRepo.projectId || undefined } : undefined,
                  },
                },
              }
            : {}),
        },
      });
      prStatusCache.delete(`${directory}::${head}::${remote}`);
      return res.json(mapPullRequest(created, repo));
    } catch (error) {
      console.error('Failed to create Azure DevOps PR:', error);
      return res.status(500).json({ error: error.message || 'Failed to create Azure DevOps PR' });
    }
  });

  app.post('/api/azure-devops/pr/update', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory.trim() : '';
      const number = typeof req.body?.number === 'number' ? req.body.number : Number(req.body?.number);
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      const remote = typeof req.body?.remote === 'string' ? req.body.remote.trim() : 'origin';
      if (!directory || !Number.isFinite(number) || number <= 0 || !title) {
        return res.status(400).json({ error: 'directory, number, and title are required' });
      }
      const client = await getClient();
      if (!client) return res.status(401).json({ error: 'Azure DevOps not connected' });
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.status(400).json({ error: 'Unable to resolve Azure DevOps repo from git remote' });
      }
      const updated = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}`, {
        method: 'PATCH',
        body: {
          title,
          description: body,
        },
      });
      return res.json(mapPullRequest(updated, repo));
    } catch (error) {
      console.error('Failed to update Azure DevOps PR:', error);
      return res.status(500).json({ error: error.message || 'Failed to update Azure DevOps PR' });
    }
  });

  app.get('/api/azure-devops/pulls/list', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const page = typeof req.query?.page === 'string' ? Number(req.query.page) : 1;
      const remote = typeof req.query?.remote === 'string' ? req.query.remote.trim() : 'origin';
      if (!directory) {
        return res.status(400).json({ error: 'directory is required' });
      }
      const client = await getClient();
      if (!client) return res.json({ connected: false });
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.json({ connected: true, repo: null, prs: [] });
      }
      const effectivePage = Number.isFinite(page) && page > 0 ? page : 1;
      const top = 50;
      const skip = (effectivePage - 1) * top;
      const listPayload = await client.request(
        `/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests`,
        {
          query: {
            'searchCriteria.status': 'active',
            '$top': top,
            '$skip': skip,
          },
        }
      );
      const prs = (Array.isArray(listPayload?.value) ? listPayload.value : []).map((pr) => {
        const mergedState = pr.status === 'completed' ? 'merged' : pr.status === 'abandoned' ? 'closed' : 'open';
        const headRepo = pr.forkSource
          ? {
              owner: pr.forkSource.repository?.project?.name || '',
              repo: pr.forkSource.repository?.name || '',
              url: pr.forkSource.repository?.webUrl || '',
            }
          : null;
        return {
          provider: 'azure-devops',
          number: pr.pullRequestId,
          title: pr.title || '',
          url: pr.webUrl || `${repo.webUrl}/pullrequest/${pr.pullRequestId}`,
          state: mergedState,
          draft: Boolean(pr.isDraft),
          base: normalizeBranchName(pr.targetRefName),
          head: normalizeBranchName(pr.sourceRefName),
          headSha: pr.lastMergeSourceCommit?.commitId || pr.lastMergeCommit?.commitId,
          mergeable: null,
          mergeableState: pr.mergeStatus || null,
          author: mapAzureIdentity(pr.createdBy),
          headLabel: pr.sourceRefName ? normalizeBranchName(pr.sourceRefName) : undefined,
          headRepo: headRepo && headRepo.owner && headRepo.repo && headRepo.url ? headRepo : null,
          sourceRepo: { ...repo, source: 'origin' },
        };
      });
      const hasMore = Array.isArray(listPayload?.value) && listPayload.value.length >= top;
      return res.json({ connected: true, repo, prs, page: effectivePage, hasMore });
    } catch (error) {
      console.error('Failed to list Azure DevOps pull requests:', error);
      return res.status(500).json({ error: error.message || 'Failed to list Azure DevOps pull requests' });
    }
  });

  app.post('/api/azure-devops/pr/complete', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory.trim() : '';
      const number = typeof req.body?.number === 'number' ? req.body.number : null;
      const method = typeof req.body?.method === 'string' ? req.body.method : 'merge';
      const remote = typeof req.body?.remote === 'string' ? req.body.remote.trim() : 'origin';
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }
      const client = await getClient();
      if (!client) return res.status(401).json({ error: 'Azure DevOps not connected' });
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.status(400).json({ error: 'Unable to resolve Azure DevOps repo from git remote' });
      }
      const strategyMap = { merge: 'noFastForward', squash: 'squash', rebase: 'rebase' };
      const mergeStrategy = strategyMap[method] || 'noFastForward';

      const currentPr = await client.request(
        `/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}`
      );
      const lastMergeSourceCommit = currentPr?.lastMergeSourceCommit;

      try {
        const result = await client.request(
          `/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}`,
          {
            method: 'PATCH',
            body: {
              status: 'completed',
              ...(lastMergeSourceCommit ? { lastMergeSourceCommit } : {}),
              completionOptions: { mergeStrategy },
            },
          }
        );
        const pr = result?.repository?.pullRequest?.[0] || result;
        prStatusCache.delete(`${directory}::${normalizeBranchName(pr?.sourceRefName || currentPr?.sourceRefName || '')}::${remote}`);
        return res.json({ merged: true, message: pr?.completionOptions?.mergeCommitMessage || undefined });
      } catch (error) {
        if (error?.status === 403) {
          return res.status(403).json({ error: 'Not authorized to complete this PR' });
        }
        if (error?.status === 405 || error?.status === 409) {
          return res.json({ merged: false, message: error?.data?.message || error.message || 'PR not mergeable' });
        }
        throw error;
      }
    } catch (error) {
      console.error('Failed to complete Azure DevOps PR:', error);
      return res.status(500).json({ error: error.message || 'Failed to complete Azure DevOps PR' });
    }
  });

  app.post('/api/azure-devops/pr/ready', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory.trim() : '';
      const number = typeof req.body?.number === 'number' ? req.body.number : null;
      const remote = typeof req.body?.remote === 'string' ? req.body.remote.trim() : 'origin';
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }
      const client = await getClient();
      if (!client) return res.status(401).json({ error: 'Azure DevOps not connected' });
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.status(400).json({ error: 'Unable to resolve Azure DevOps repo from git remote' });
      }
      const current = await client.request(
        `/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}`
      );
      if (!current?.isDraft) {
        return res.json({ ready: true });
      }
      await client.request(
        `/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}`,
        {
          method: 'PATCH',
          body: { isDraft: false },
        }
      );
      prStatusCache.delete(`${directory}::${normalizeBranchName(current.sourceRefName || '')}::${remote}`);
      return res.json({ ready: true });
    } catch (error) {
      console.error('Failed to mark Azure DevOps PR ready:', error);
      return res.status(500).json({ error: error.message || 'Failed to mark Azure DevOps PR ready' });
    }
  });

  app.get('/api/azure-devops/pulls/context', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const number = typeof req.query?.number === 'string' ? Number(req.query.number) : NaN;
      const includeDiff = req.query?.diff === '1' || req.query?.diff === 'true';
      const remote = typeof req.query?.remote === 'string' ? req.query.remote.trim() : 'origin';
      if (!directory || !Number.isFinite(number) || number <= 0) {
        return res.status(400).json({ error: 'directory and number are required' });
      }
      const client = await getClient();
      if (!client) return res.status(401).json({ error: 'Azure DevOps not connected' });
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.status(400).json({ error: 'Unable to resolve Azure DevOps repo from git remote' });
      }

      const includeCheckDetails = req.query?.checkDetails === '1' || req.query?.checkDetails === 'true';
      const pr = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}`);
      const threadsPayload = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}/threads`).catch(() => ({ value: [] }));
      const { issueComments, reviewComments } = mapAzureThreadComments(threadsPayload?.value);
      const checksResult = await loadAzureDevOpsChecks({ client, repo, pullRequestId: number, includeCheckDetails });
      const filesResult = await loadAzurePullRequestFilesAndDiff({ client, repo, pr, includeDiff });

      return res.json({
        connected: true,
        provider: 'azure-devops',
        repo,
        pr: mapPullRequest(pr, repo),
        issueComments,
        reviewComments,
        files: filesResult.files,
        ...(filesResult.diff ? { diff: filesResult.diff } : {}),
        checks: checksResult.checks,
        checkRuns: checksResult.checkRuns,
      });
    } catch (error) {
      console.error('Failed to load Azure DevOps PR context:', error);
      return res.status(500).json({ error: error.message || 'Failed to load Azure DevOps PR context' });
    }
  });

  app.get('/api/azure-devops/issues/list', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const page = typeof req.query?.page === 'string' ? Number(req.query.page) : 1;
      const remote = typeof req.query?.remote === 'string' ? req.query.remote.trim() : 'origin';
      if (!directory) {
        return res.status(400).json({ error: 'directory is required' });
      }
      const client = await getClient();
      if (!client) return res.json({ connected: false });
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.json({ connected: true, repo: null, issues: [] });
      }

      const wiqlPayload = await client.request(`/${encodeURIComponent(repo.project)}/_apis/wit/wiql`, {
        method: 'POST',
        body: { query: OPEN_WORK_ITEMS_WIQL },
      });
      const workItems = Array.isArray(wiqlPayload?.workItems) ? wiqlPayload.workItems : [];
      const effectivePage = Number.isFinite(page) && page > 0 ? page : 1;
      const start = (effectivePage - 1) * WORK_ITEMS_PAGE_SIZE;
      const pageIds = workItems.slice(start, start + WORK_ITEMS_PAGE_SIZE).map((item) => item?.id).filter((id) => Number.isFinite(id));
      if (!pageIds.length) {
        return res.json({ connected: true, repo, issues: [], page: effectivePage, hasMore: start + WORK_ITEMS_PAGE_SIZE < workItems.length });
      }

      const detailsPayload = await client.request(`/${encodeURIComponent(repo.project)}/_apis/wit/workitems`, {
        query: {
          ids: pageIds.join(','),
          '$expand': 'fields',
        },
      });
      const details = Array.isArray(detailsPayload?.value) ? detailsPayload.value : [];
      const detailsById = new Map(details.map((item) => [item?.id, item]));
      const issues = pageIds.map((id) => detailsById.get(id)).filter(Boolean).map((item) => mapAzureWorkItemSummary(item, repo));

      return res.json({
        connected: true,
        repo,
        issues,
        page: effectivePage,
        hasMore: start + WORK_ITEMS_PAGE_SIZE < workItems.length,
      });
    } catch (error) {
      console.error('Failed to list Azure DevOps work items:', error);
      return res.status(500).json({ error: error.message || 'Failed to list Azure DevOps work items' });
    }
  });

  app.get('/api/azure-devops/issues/get', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const number = typeof req.query?.number === 'string' ? Number(req.query.number) : null;
      const remote = typeof req.query?.remote === 'string' ? req.query.remote.trim() : 'origin';
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }
      const client = await getClient();
      if (!client) return res.json({ connected: false });
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.json({ connected: true, repo: null, issue: null });
      }

      let workItem;
      try {
        workItem = await client.request(`/${encodeURIComponent(repo.project)}/_apis/wit/workitems/${encodeURIComponent(number)}`, {
          query: { '$expand': 'all' },
        });
      } catch (error) {
        if (error?.status === 404) {
          return res.json({ connected: true, repo, issue: null });
        }
        throw error;
      }

      return res.json({ connected: true, repo, issue: mapAzureWorkItem(workItem, repo) });
    } catch (error) {
      console.error('Failed to fetch Azure DevOps work item:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch Azure DevOps work item' });
    }
  });

  app.get('/api/azure-devops/issues/comments', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const number = typeof req.query?.number === 'string' ? Number(req.query.number) : null;
      const remote = typeof req.query?.remote === 'string' ? req.query.remote.trim() : 'origin';
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }
      const client = await getClient();
      if (!client) return res.json({ connected: false });
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.json({ connected: true, repo: null, comments: [] });
      }

      const payload = await client.request(`/${encodeURIComponent(repo.project)}/_apis/wit/workitems/${encodeURIComponent(number)}/comments`, {
        query: { 'api-version': '7.1-preview' },
      }).catch((error) => {
        if (error?.status === 404) {
          return { comments: [] };
        }
        throw error;
      });
      const comments = (Array.isArray(payload?.comments) ? payload.comments : Array.isArray(payload?.value) ? payload.value : [])
        .map((comment, index) => ({
          id: Number(comment?.id || index + 1),
          url: buildAzureWorkItemUrl(repo, number),
          body: typeof comment?.text === 'string' ? comment.text : '',
          author: mapAzureIdentity(comment?.createdBy),
          createdAt: comment?.createdDate || undefined,
          updatedAt: comment?.modifiedDate || comment?.createdDate || undefined,
        }))
        .filter((comment) => comment.body);

      return res.json({ connected: true, repo, comments });
    } catch (error) {
      console.error('Failed to fetch Azure DevOps work item comments:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch Azure DevOps work item comments' });
    }
  });

  app.get('/api/azure-devops/repo/branches', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const remote = typeof req.query?.remote === 'string' ? req.query.remote.trim() : 'origin';
      if (!directory) {
        return res.status(400).json({ error: 'directory is required' });
      }
      const client = await getClient();
      if (!client) {
        return res.json({ branches: [] });
      }
      const repo = await resolveRepoForRequest(client, directory, remote);
      if (!repo) {
        return res.json({ branches: [] });
      }
      const branches = await listAzureRepoBranches(client, repo);
      return res.json({ branches });
    } catch (error) {
      console.error('Failed to fetch Azure DevOps repo branches:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch Azure DevOps repo branches' });
    }
  });

  app.get('/api/azure-devops/repo/upstream', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      if (!directory) {
        return res.status(400).json({ error: 'directory is required' });
      }
      const client = await getClient();
      if (!client) {
        return res.json({ connected: false, isFork: false, upstream: null });
      }
      const repo = await resolveRepoForRequest(client, directory, 'origin');
      if (!repo) {
        return res.json({ connected: true, isFork: false, upstream: null });
      }

      const metadata = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}`);
      const upstream = await mapAzureUpstreamRepo({ directory, client, parentRepository: metadata?.parentRepository });
      return res.json({ connected: true, isFork: Boolean(upstream), upstream });
    } catch (error) {
      console.error('Failed to detect Azure DevOps upstream repo:', error);
      return res.status(500).json({ error: error.message || 'Failed to detect Azure DevOps upstream repo' });
    }
  });
}
