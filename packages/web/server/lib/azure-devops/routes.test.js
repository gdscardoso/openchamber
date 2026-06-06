import { beforeEach, describe, expect, it, mock } from 'bun:test';

const azureLibraries = {
  createAzureDevOpsClient: mock(),
  resolveAzureDevOpsRepoFromDirectory: mock(),
};

const gitLibraries = {
  getRemotes: mock(),
};

mock.module('./index.js', () => azureLibraries);
mock.module('../git/index.js', () => gitLibraries);

const { registerAzureDevOpsRoutes } = await import('./routes.js');

const createRouteRegistry = () => {
  const routes = new Map();

  return {
    app: {
      get(routePath, handler) {
        routes.set(`GET ${routePath}`, handler);
      },
      post(routePath, handler) {
        routes.set(`POST ${routePath}`, handler);
      },
      put(routePath, handler) {
        routes.set(`PUT ${routePath}`, handler);
      },
      delete(routePath, handler) {
        routes.set(`DELETE ${routePath}`, handler);
      },
    },
    getRoute(method, routePath) {
      return routes.get(`${method} ${routePath}`);
    },
  };
};

const createMockResponse = () => {
  let statusCode = 200;
  let body = null;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
};

const makeMockClient = (customRequest = null) => ({
  auth: { organization: 'testorg', pat: 'testpat' },
  request: customRequest || mock(async () => ({})),
  getProfile: mock(async () => ({ displayName: 'Test User' })),
});

describe('Azure DevOps PR list routes', () => {
  beforeEach(() => {
    azureLibraries.createAzureDevOpsClient.mockReset();
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockReset();
    gitLibraries.getRemotes.mockReset();
  });

  it('GET /api/azure-devops/pulls/list returns 400 when directory missing', async () => {
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/pulls/list')(
      { query: {} },
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('directory is required');
  });

  it('GET /api/azure-devops/pulls/list returns disconnected when no client', async () => {
    azureLibraries.createAzureDevOpsClient.mockReturnValue(null);
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/pulls/list')(
      { query: { directory: '/repo' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ connected: false });
  });

  it('GET /api/azure-devops/pulls/list returns empty when repo not resolved', async () => {
    const mockRequest = mock(async () => ({}));
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({ repo: null, remoteUrl: 'https://dev.azure.com/org' });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/pulls/list')(
      { query: { directory: '/repo' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ connected: true, repo: null, prs: [] });
  });

  it('GET /api/azure-devops/pulls/list maps PRs correctly', async () => {
    const mockRequest = mock(async (path) => {
      if (path.includes('/pullrequests')) {
        return {
          value: [
            {
              pullRequestId: 42,
              title: 'Test PR',
              status: 'active',
              isDraft: false,
              targetRefName: 'refs/heads/main',
              sourceRefName: 'refs/heads/feature',
              lastMergeSourceCommit: { commitId: 'abc123' },
              mergeStatus: 'succeeded',
              createdBy: { displayName: 'Author', id: 'auth1', uniqueName: 'auth@org.com' },
              webUrl: 'https://dev.azure.com/org/project/_git/repo/pullrequest/42',
              forkSource: null,
            },
          ],
          count: 1,
        };
      }
      return {};
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo', webUrl: 'https://dev.azure.com/org/proj/_git/repo' },
    });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/pulls/list')(
      { query: { directory: '/repo', page: '1' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.connected).toBe(true);
    expect(response.body.prs).toHaveLength(1);
    expect(response.body.prs[0].number).toBe(42);
    expect(response.body.prs[0].title).toBe('Test PR');
    expect(response.body.prs[0].state).toBe('open');
    expect(response.body.prs[0].draft).toBe(false);
    expect(response.body.prs[0].head).toBe('feature');
    expect(response.body.prs[0].base).toBe('main');
    expect(response.body.prs[0].provider).toBe('azure-devops');
    expect(response.body.page).toBe(1);
    expect(response.body.hasMore).toBe(false);
  });

  it('GET /api/azure-devops/pulls/list handles hasMore when results >= top', async () => {
    const prs = Array.from({ length: 50 }, (_, i) => ({
      pullRequestId: i + 1,
      title: `PR ${i + 1}`,
      status: 'active',
      isDraft: false,
      targetRefName: 'refs/heads/main',
      sourceRefName: 'refs/heads/feature',
      createdBy: { displayName: 'Author' },
    }));
    const mockRequest = mock(async () => ({ value: prs, count: 50 }));
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo', webUrl: 'https://dev.azure.com/org/proj/_git/repo' },
    });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/pulls/list')(
      { query: { directory: '/repo' } },
      response,
    );

    expect(response.body.prs).toHaveLength(50);
    expect(response.body.hasMore).toBe(true);
  });
});

describe('Azure DevOps PR complete routes', () => {
  beforeEach(() => {
    azureLibraries.createAzureDevOpsClient.mockReset();
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockReset();
  });

  it('POST /api/azure-devops/pr/complete returns 400 when directory missing', async () => {
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/complete')(
      { body: { number: 42 } },
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('directory and number are required');
  });

  it('POST /api/azure-devops/pr/complete returns 400 when number missing', async () => {
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/complete')(
      { body: { directory: '/repo' } },
      response,
    );

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/azure-devops/pr/complete returns 401 when not connected', async () => {
    azureLibraries.createAzureDevOpsClient.mockReturnValue(null);
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/complete')(
      { body: { directory: '/repo', number: 42 } },
      response,
    );

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/azure-devops/pr/complete returns 400 when repo not resolved', async () => {
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient());
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({ repo: null });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/complete')(
      { body: { directory: '/repo', number: 42 } },
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('Unable to resolve Azure DevOps repo from git remote');
  });

  it('POST /api/azure-devops/pr/complete merges with default strategy', async () => {
    const mockRequest = mock(async () => ({
      pullRequestId: 42,
      status: 'completed',
      completionOptions: { mergeCommitMessage: 'Merged PR 42' },
      sourceRefName: 'refs/heads/feature',
    }));
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/complete')(
      { body: { directory: '/repo', number: 42 } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ merged: true, message: 'Merged PR 42' });
  });

  it('POST /api/azure-devops/pr/complete handles squash method', async () => {
    let patchCalled = false;
    const mockRequest = mock(async (path, options) => {
      if (options?.method === 'PATCH') {
        patchCalled = true;
        expect(options.body.completionOptions.mergeStrategy).toBe('squash');
        return { status: 'completed', sourceRefName: 'refs/heads/feature' };
      }
      return { pullRequestId: 42, lastMergeSourceCommit: { commitId: 'abc123' }, sourceRefName: 'refs/heads/feature' };
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/complete')(
      { body: { directory: '/repo', number: 42, method: 'squash' } },
      response,
    );

    expect(patchCalled).toBe(true);
    expect(response.statusCode).toBe(200);
  });

  it('POST /api/azure-devops/pr/complete handles 403 not authorized', async () => {
    let callCount = 0;
    const mockRequest = mock(async (_path, options) => {
      callCount++;
      if (options?.method === 'PATCH') {
        const error = new Error('Not authorized');
        error.status = 403;
        throw error;
      }
      return { pullRequestId: 42, lastMergeSourceCommit: { commitId: 'abc123' } };
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/complete')(
      { body: { directory: '/repo', number: 42 } },
      response,
    );

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(response.statusCode).toBe(403);
  });

  it('POST /api/azure-devops/pr/complete handles 405 conflict as not mergeable', async () => {
    let callCount = 0;
    const mockRequest = mock(async (_path, options) => {
      callCount++;
      if (options?.method === 'PATCH') {
        const error = new Error('Conflict');
        error.status = 405;
        error.data = { message: 'PR has conflicts' };
        throw error;
      }
      return { pullRequestId: 42, lastMergeSourceCommit: { commitId: 'abc123' } };
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/complete')(
      { body: { directory: '/repo', number: 42 } },
      response,
    );

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(response.statusCode).toBe(200);
    expect(response.body.merged).toBe(false);
    expect(response.body.message).toBe('PR has conflicts');
  });
});

describe('Azure DevOps PR create routes', () => {
  beforeEach(() => {
    azureLibraries.createAzureDevOpsClient.mockReset();
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockReset();
    gitLibraries.getRemotes.mockReset();
  });

  it('POST /api/azure-devops/pr/create supports explicit cross-repo target', async () => {
    const mockRequest = mock(async (path, options) => {
      if (path === '/proj/_apis/git/repositories/upstream-id') {
        return {
          id: 'upstream-id',
          name: 'upstream-repo',
          project: { id: 'proj-id', name: 'proj' },
          defaultBranch: 'refs/heads/main',
          webUrl: 'https://dev.azure.com/testorg/proj/_git/upstream-repo',
          remoteUrl: 'https://dev.azure.com/testorg/proj/_git/upstream-repo',
        };
      }

      if (path === '/proj/_apis/git/repositories/upstream-id/pullrequests') {
        expect(options?.method).toBe('POST');
        expect(options?.body?.sourceRefName).toBe('refs/heads/feature');
        expect(options?.body?.targetRefName).toBe('refs/heads/main');
        expect(options?.body?.forkSource?.repository?.id).toBe('source-id');
        expect(options?.body?.forkSource?.repository?.name).toBe('source-repo');
        return {
          pullRequestId: 77,
          title: 'Cross repo PR',
          description: 'Body',
          status: 'active',
          sourceRefName: 'refs/heads/feature',
          targetRefName: 'refs/heads/main',
          repository: { id: 'upstream-id', name: 'upstream-repo' },
          webUrl: 'https://dev.azure.com/testorg/proj/_git/upstream-repo/pullrequest/77',
        };
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockImplementation(async (_directory, remoteName) => {
      if (remoteName === 'origin') {
        return {
          repo: {
            organization: 'testorg',
            project: 'proj',
            projectId: 'proj-id',
            repositoryId: 'source-id',
            repo: 'source-repo',
            webUrl: 'https://dev.azure.com/testorg/proj/_git/source-repo',
            url: 'https://dev.azure.com/testorg/proj/_git/source-repo',
          },
        };
      }
      return { repo: null };
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/create')(
      {
        body: {
          directory: '/repo',
          title: 'Cross repo PR',
          head: 'feature',
          base: 'main',
          body: 'Body',
          headRemote: 'origin',
          targetRepo: {
            organization: 'testorg',
            project: 'proj',
            repo: 'upstream-repo',
            repositoryId: 'upstream-id',
          },
        },
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.number).toBe(77);
    expect(response.body.url).toContain('/pullrequest/77');
  });
});

describe('Azure DevOps PR ready routes', () => {
  beforeEach(() => {
    azureLibraries.createAzureDevOpsClient.mockReset();
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockReset();
  });

  it('POST /api/azure-devops/pr/ready returns 400 when directory missing', async () => {
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/ready')(
      { body: { number: 42 } },
      response,
    );

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/azure-devops/pr/ready returns 401 when not connected', async () => {
    azureLibraries.createAzureDevOpsClient.mockReturnValue(null);
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/ready')(
      { body: { directory: '/repo', number: 42 } },
      response,
    );

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/azure-devops/pr/ready skips API call when already ready', async () => {
    const mockRequest = mock(async (path) => {
      if (!path.includes('/threads')) {
        return { pullRequestId: 42, isDraft: false, status: 'active' };
      }
      return {};
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/ready')(
      { body: { directory: '/repo', number: 42 } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ready: true });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('POST /api/azure-devops/pr/ready marks draft as ready', async () => {
    let patchCalled = false;
    const mockRequest = mock(async (path, options) => {
      if (options?.method === 'PATCH') {
        patchCalled = true;
        expect(options.body.isDraft).toBe(false);
        return { pullRequestId: 42, isDraft: false };
      }
      return { pullRequestId: 42, isDraft: true, status: 'active' };
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });
    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('POST', '/api/azure-devops/pr/ready')(
      { body: { directory: '/repo', number: 42 } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ready: true });
    expect(patchCalled).toBe(true);
  });
});

describe('Azure DevOps PR context routes', () => {
  beforeEach(() => {
    azureLibraries.createAzureDevOpsClient.mockReset();
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockReset();
  });

  it('GET /api/azure-devops/pulls/context maps files and diff summary', async () => {
    const mockRequest = mock(async (path, options) => {
      if (path.endsWith('/pullrequests/42') && !path.endsWith('/statuses')) {
        return {
          pullRequestId: 42,
          title: 'Test PR',
          status: 'active',
          isDraft: false,
          sourceRefName: 'refs/heads/feature',
          targetRefName: 'refs/heads/main',
          lastMergeSourceCommit: { commitId: 'headsha' },
          lastMergeTargetCommit: { commitId: 'basesha' },
        };
      }
      if (path.endsWith('/pullrequests/42/threads')) {
        return { value: [] };
      }
      if (path.includes('/_apis/git/policy/evaluations')) {
        return { value: [] };
      }
      if (path.includes('/_apis/build/builds')) {
        return { value: [] };
      }
      if (path.endsWith('/pullrequests/42/statuses')) {
        return { value: [] };
      }
      if (path.includes('/_apis/git/repositories/repo1/diffs/commits')) {
        expect(options?.query?.baseVersion).toBe('basesha');
        expect(options?.query?.targetVersion).toBe('headsha');
        return {
          allChangesIncluded: true,
          changes: [
            {
              changeType: 'edit',
              item: { path: '/src/app.ts', gitObjectType: 'blob' },
            },
            {
              changeType: 'rename',
              originalPath: '/src/old.ts',
              item: { path: '/src/new.ts', gitObjectType: 'blob' },
            },
            {
              changeType: 'edit',
              item: { path: '/src', gitObjectType: 'tree', isFolder: true },
            },
          ],
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo', webUrl: 'https://dev.azure.com/org/proj/_git/repo' },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/pulls/context')(
      { query: { directory: '/repo', number: '42', diff: '1' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.connected).toBe(true);
    expect(response.body.files).toEqual([
      {
        filename: '/src/app.ts',
        status: 'modified',
        previousFilename: undefined,
        additions: undefined,
        deletions: undefined,
        changes: undefined,
        patch: undefined,
      },
      {
        filename: '/src/new.ts',
        status: 'renamed',
        previousFilename: '/src/old.ts',
        additions: undefined,
        deletions: undefined,
        changes: undefined,
        patch: undefined,
      },
    ]);
    expect(response.body.diff).toContain('# Azure DevOps PR 42 diff summary');
    expect(response.body.diff).toContain('diff --azure modified /src/app.ts');
    expect(response.body.diff).toContain('rename from /src/old.ts');
    expect(response.body.diff).toContain('rename to /src/new.ts');
  });
});

describe('Azure DevOps work item routes', () => {
  beforeEach(() => {
    azureLibraries.createAzureDevOpsClient.mockReset();
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockReset();
  });

  it('GET /api/azure-devops/issues/list maps work items correctly', async () => {
    const mockRequest = mock(async (path, options) => {
      if (path.endsWith('/_apis/wit/wiql')) {
        expect(options?.method).toBe('POST');
        expect(options?.body?.query).toContain('[System.TeamProject] = @project');
        expect(options?.body?.query).toContain("[System.State] <> 'Closed'");
        return { workItems: [{ id: 101 }, { id: 102 }] };
      }
      if (path.endsWith('/_apis/wit/workitems')) {
        expect(options?.query?.ids).toBe('101,102');
        return {
          value: [
            {
              id: 102,
              fields: {
                'System.Title': 'Second item',
                'System.State': 'Done',
                'System.WorkItemType': 'Bug',
                'System.AssignedTo': { displayName: 'Bob', uniqueName: 'bob@org.com', id: 'user-2' },
              },
            },
            {
              id: 101,
              fields: {
                'System.Title': 'First item',
                'System.State': 'Active',
                'System.WorkItemType': 'User Story',
                'System.AssignedTo': { displayName: 'Alice', uniqueName: 'alice@org.com', id: 'user-1' },
              },
            },
          ],
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: {
        organization: 'org',
        project: 'proj',
        repositoryId: 'repo1',
        repo: 'repo',
        webUrl: 'https://dev.azure.com/org/proj/_git/repo',
      },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/issues/list')(
      { query: { directory: '/repo', page: '1' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.connected).toBe(true);
    expect(response.body.issues).toEqual([
      {
        number: 101,
        title: 'First item',
        url: 'https://dev.azure.com/org/proj/_workitems/edit/101',
        state: 'open',
        author: { login: 'alice@org.com', id: 'user-1', name: 'Alice', email: 'alice@org.com', avatarUrl: undefined },
        labels: [{ name: 'User Story' }],
      },
      {
        number: 102,
        title: 'Second item',
        url: 'https://dev.azure.com/org/proj/_workitems/edit/102',
        state: 'closed',
        author: { login: 'bob@org.com', id: 'user-2', name: 'Bob', email: 'bob@org.com', avatarUrl: undefined },
        labels: [{ name: 'Bug' }],
      },
    ]);
    expect(response.body.hasMore).toBe(false);
  });

  it('GET /api/azure-devops/issues/list returns empty when WIQL empty', async () => {
    const mockRequest = mock(async (path) => {
      if (path.endsWith('/_apis/wit/wiql')) {
        return { workItems: [] };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: {
        organization: 'org',
        project: 'proj',
        repositoryId: 'repo1',
        repo: 'repo',
        webUrl: 'https://dev.azure.com/org/proj/_git/repo',
      },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/issues/list')(
      { query: { directory: '/repo' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.issues).toEqual([]);
    expect(response.body.hasMore).toBe(false);
  });

  it('GET /api/azure-devops/issues/get returns work item details', async () => {
    const mockRequest = mock(async (path) => {
      if (path.endsWith('/_apis/wit/workitems/101')) {
        return {
          id: 101,
          fields: {
            'System.Title': 'Investigate bug',
            'System.State': 'Active',
            'System.WorkItemType': 'Bug',
            'System.Description': '<p>Details</p>',
            'System.CreatedDate': '2026-01-01T00:00:00Z',
            'System.ChangedDate': '2026-01-02T00:00:00Z',
            'System.AssignedTo': { displayName: 'Alice', uniqueName: 'alice@org.com', id: 'user-1' },
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: {
        organization: 'org',
        project: 'proj',
        repositoryId: 'repo1',
        repo: 'repo',
        webUrl: 'https://dev.azure.com/org/proj/_git/repo',
      },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/issues/get')(
      { query: { directory: '/repo', number: '101' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.issue).toEqual({
      number: 101,
      title: 'Investigate bug',
      url: 'https://dev.azure.com/org/proj/_workitems/edit/101',
      state: 'open',
      author: { login: 'alice@org.com', id: 'user-1', name: 'Alice', email: 'alice@org.com', avatarUrl: undefined },
      labels: [{ name: 'Bug' }],
      body: '<p>Details</p>',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      assignees: [{ login: 'alice@org.com', id: 'user-1', name: 'Alice', email: 'alice@org.com', avatarUrl: undefined }],
    });
  });

  it('GET /api/azure-devops/issues/get returns null when work item not found', async () => {
    const mockRequest = mock(async () => {
      const error = new Error('Not found');
      error.status = 404;
      throw error;
    });

    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: {
        organization: 'org',
        project: 'proj',
        repositoryId: 'repo1',
        repo: 'repo',
        webUrl: 'https://dev.azure.com/org/proj/_git/repo',
      },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/issues/get')(
      { query: { directory: '/repo', number: '999' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.issue).toBeNull();
  });

  it('GET /api/azure-devops/issues/comments maps comments correctly', async () => {
    const mockRequest = mock(async (path) => {
      if (path.endsWith('/_apis/wit/workitems/101/comments')) {
        return {
          comments: [
            {
              id: 7,
              text: 'Need logs',
              createdBy: { displayName: 'Alice', uniqueName: 'alice@org.com', id: 'user-1' },
              createdDate: '2026-01-01T00:00:00Z',
              modifiedDate: '2026-01-01T01:00:00Z',
            },
          ],
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: {
        organization: 'org',
        project: 'proj',
        repositoryId: 'repo1',
        repo: 'repo',
        webUrl: 'https://dev.azure.com/org/proj/_git/repo',
      },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/issues/comments')(
      { query: { directory: '/repo', number: '101' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.comments).toEqual([
      {
        id: 7,
        url: 'https://dev.azure.com/org/proj/_workitems/edit/101',
        body: 'Need logs',
        author: { login: 'alice@org.com', id: 'user-1', name: 'Alice', email: 'alice@org.com', avatarUrl: undefined },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T01:00:00Z',
      },
    ]);
    expect(mockRequest).toHaveBeenCalledWith('/proj/_apis/wit/workitems/101/comments', {
      query: { 'api-version': '7.1-preview' },
    });
  });

  it('GET /api/azure-devops/issues/comments returns empty comments', async () => {
    const mockRequest = mock(async (path) => {
      if (path.endsWith('/_apis/wit/workitems/101/comments')) {
        return { comments: [] };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: {
        organization: 'org',
        project: 'proj',
        repositoryId: 'repo1',
        repo: 'repo',
        webUrl: 'https://dev.azure.com/org/proj/_git/repo',
      },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/issues/comments')(
      { query: { directory: '/repo', number: '101' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.comments).toEqual([]);
  });
});

describe('Azure DevOps repo routes', () => {
  beforeEach(() => {
    azureLibraries.createAzureDevOpsClient.mockReset();
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockReset();
    gitLibraries.getRemotes.mockReset();
  });

  it('GET /api/azure-devops/repo/branches returns branches', async () => {
    const mockRequest = mock(async (path, options) => {
      if (path.endsWith('/_apis/git/repositories/repo1/refs')) {
        expect(options?.query?.filter).toBe('heads/');
        return {
          data: {
            value: [
              { name: 'refs/heads/main' },
              { name: 'refs/heads/feature/test' },
            ],
          },
          headers: new Headers(),
          status: 200,
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/repo/branches')(
      { query: { directory: '/repo' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ branches: ['main', 'feature/test'] });
  });

  it('GET /api/azure-devops/repo/branches paginates with continuation token', async () => {
    let callCount = 0;
    const mockRequest = mock(async (path) => {
      if (!path.endsWith('/_apis/git/repositories/repo1/refs')) {
        throw new Error(`Unexpected path: ${path}`);
      }
      callCount += 1;
      return callCount === 1
        ? {
            data: { value: [{ name: 'refs/heads/main' }] },
            headers: new Headers({ 'x-ms-continuationtoken': 'next-page' }),
            status: 200,
          }
        : {
            data: { value: [{ name: 'refs/heads/release' }] },
            headers: new Headers(),
            status: 200,
          };
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/repo/branches')(
      { query: { directory: '/repo' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ branches: ['main', 'release'] });
  });

  it('GET /api/azure-devops/repo/upstream returns fork upstream', async () => {
    const mockRequest = mock(async (path) => {
      if (path.endsWith('/_apis/git/repositories/repo1')) {
        return {
          id: 'repo1',
          name: 'repo',
          project: { name: 'proj' },
          parentRepository: {
            id: 'upstream-id',
            name: 'upstream-repo',
            project: { name: 'proj' },
            defaultBranch: 'refs/heads/main',
            webUrl: 'https://dev.azure.com/testorg/proj/_git/upstream-repo',
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockImplementation(async (_directory, remote) => {
      if (remote === 'upstream') {
        return {
          repo: {
            organization: 'testorg',
            project: 'proj',
            repositoryId: 'upstream-id',
            repo: 'upstream-repo',
          },
        };
      }
      return {
        repo: {
          organization: 'testorg',
          project: 'proj',
          repositoryId: 'repo1',
          repo: 'repo',
        },
      };
    });
    gitLibraries.getRemotes.mockResolvedValue([
      { name: 'origin', fetchUrl: 'https://dev.azure.com/testorg/proj/_git/repo', pushUrl: 'https://dev.azure.com/testorg/proj/_git/repo' },
      { name: 'upstream', fetchUrl: 'https://dev.azure.com/testorg/proj/_git/upstream-repo', pushUrl: 'https://dev.azure.com/testorg/proj/_git/upstream-repo' },
    ]);

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/repo/upstream')(
      { query: { directory: '/repo' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      connected: true,
      isFork: true,
      upstream: {
        organization: 'testorg',
        project: 'proj',
        repo: 'upstream-repo',
        repositoryId: 'upstream-id',
        url: 'https://dev.azure.com/testorg/proj/_git/upstream-repo',
        defaultBranch: 'main',
        remoteName: 'upstream',
      },
    });
  });

  it('GET /api/azure-devops/repo/upstream returns not fork when parent missing', async () => {
    const mockRequest = mock(async (path) => {
      if (path.endsWith('/_apis/git/repositories/repo1')) {
        return { id: 'repo1', name: 'repo', project: { name: 'proj' } };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    azureLibraries.createAzureDevOpsClient.mockReturnValue(makeMockClient(mockRequest));
    azureLibraries.resolveAzureDevOpsRepoFromDirectory.mockResolvedValue({
      repo: { organization: 'testorg', project: 'proj', repositoryId: 'repo1', repo: 'repo' },
    });

    const { app, getRoute } = createRouteRegistry();
    registerAzureDevOpsRoutes(app);
    const response = createMockResponse();

    await getRoute('GET', '/api/azure-devops/repo/upstream')(
      { query: { directory: '/repo' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ connected: true, isFork: false, upstream: null });
  });
});
