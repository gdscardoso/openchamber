const PR_STATUS_CACHE_TTL_MS = 90_000;
const PR_STATUS_CACHE_MAX_ENTRIES = 200;
const prStatusCache = new Map();

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
      if (!directory || !title || !head || !base) {
        return res.status(400).json({ error: 'directory, title, head, base are required' });
      }
      const client = await getClient();
      if (!client) return res.status(401).json({ error: 'Azure DevOps not connected' });
      const { resolveAzureDevOpsRepoFromDirectory } = await getLibraries();
      const { repo } = await resolveAzureDevOpsRepoFromDirectory(directory, remote, client);
      if (!repo?.project) {
        return res.status(400).json({ error: 'Unable to resolve Azure DevOps repo from git remote' });
      }
      const created = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests`, {
        method: 'POST',
        body: {
          sourceRefName: `refs/heads/${head}`,
          targetRefName: `refs/heads/${base}`,
          title,
          description: body,
          isDraft: draft,
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

  app.get('/api/azure-devops/pulls/context', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const number = typeof req.query?.number === 'string' ? Number(req.query.number) : NaN;
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

      const pr = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}`);
      const threadsPayload = await client.request(`/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repositoryId || repo.repo)}/pullrequests/${encodeURIComponent(number)}/threads`).catch(() => ({ value: [] }));
      const { issueComments, reviewComments } = mapAzureThreadComments(threadsPayload?.value);

      return res.json({
        connected: true,
        provider: 'azure-devops',
        repo,
        pr: mapPullRequest(pr, repo),
        issueComments,
        reviewComments,
        files: [],
        checks: null,
        checkRuns: [],
      });
    } catch (error) {
      console.error('Failed to load Azure DevOps PR context:', error);
      return res.status(500).json({ error: error.message || 'Failed to load Azure DevOps PR context' });
    }
  });
}
