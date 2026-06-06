import { createTasksRuntime, TasksRuntimeError } from './runtime.js';

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseWorkspaceID = (req) => asNonEmptyString(req?.params?.id);
const parseTaskID = (req) => asNonEmptyString(req?.params?.taskId);

const respondWithError = (res, error, fallbackMessage) => {
  const status = error instanceof TasksRuntimeError && typeof error.status === 'number' ? error.status : 500;
  const message = error instanceof Error ? error.message : fallbackMessage;
  const code = error instanceof TasksRuntimeError ? error.code : undefined;
  if (status >= 500) {
    console.error('[Tasks] request failed:', error);
  }
  return res.status(status).json(code ? { error: message, code } : { error: message });
};

const emitOpenChamberEvent = (dependencies, type, properties) => {
  const clients = dependencies.getOpenChamberEventClients();
  for (const client of clients) {
    try {
      dependencies.writeSseEvent(client, { type, properties });
    } catch {
      clients.delete(client);
    }
  }
};

export const registerTasksRoutes = (app, dependencies) => {
  const runtime = createTasksRuntime({
    fsPromises: dependencies.fsPromises,
    path: dependencies.path,
    openchamberDataDir: dependencies.openchamberDataDir,
    listProjectIDs: async () => {
      const settings = await dependencies.readSettingsFromDiskMigrated();
      const projects = dependencies.sanitizeProjects(settings?.projects || []);
      return projects.map((project) => project.id).filter(Boolean);
    },
  });

  app.get('/api/workspaces', async (_req, res) => {
    try {
      const workspaces = await runtime.listWorkspaces();
      return res.json({ workspaces });
    } catch (error) {
      return respondWithError(res, error, 'Failed to load workspaces');
    }
  });

  app.post('/api/workspaces', async (req, res) => {
    try {
      const workspace = await runtime.createWorkspace(req.body ?? {});
      emitOpenChamberEvent(dependencies, 'openchamber:workspace.created', { workspace });
      return res.status(201).json({ workspace });
    } catch (error) {
      return respondWithError(res, error, 'Failed to create workspace');
    }
  });

  app.get('/api/workspaces/:id', async (req, res) => {
    const workspaceID = parseWorkspaceID(req);
    if (!workspaceID) {
      return res.status(400).json({ error: 'workspaceId is required', code: 'VALIDATION_ERROR' });
    }
    try {
      const workspace = await runtime.getWorkspace(workspaceID);
      if (!workspace) {
        return res.status(404).json({ error: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' });
      }
      return res.json({ workspace });
    } catch (error) {
      return respondWithError(res, error, 'Failed to load workspace');
    }
  });

  app.put('/api/workspaces/:id', async (req, res) => {
    const workspaceID = parseWorkspaceID(req);
    if (!workspaceID) {
      return res.status(400).json({ error: 'workspaceId is required', code: 'VALIDATION_ERROR' });
    }
    try {
      const result = await runtime.updateWorkspace(workspaceID, req.body ?? {});
      emitOpenChamberEvent(dependencies, 'openchamber:workspace.updated', {
        id: workspaceID,
        patch: result.patch,
      });
      return res.json({ workspace: result.workspace });
    } catch (error) {
      return respondWithError(res, error, 'Failed to update workspace');
    }
  });

  app.delete('/api/workspaces/:id', async (req, res) => {
    const workspaceID = parseWorkspaceID(req);
    if (!workspaceID) {
      return res.status(400).json({ error: 'workspaceId is required', code: 'VALIDATION_ERROR' });
    }
    try {
      await runtime.deleteWorkspace(workspaceID);
      emitOpenChamberEvent(dependencies, 'openchamber:workspace.deleted', { id: workspaceID });
      return res.json({ ok: true });
    } catch (error) {
      return respondWithError(res, error, 'Failed to delete workspace');
    }
  });

  app.get('/api/workspaces/:id/tasks', async (req, res) => {
    const workspaceID = parseWorkspaceID(req);
    if (!workspaceID) {
      return res.status(400).json({ error: 'workspaceId is required', code: 'VALIDATION_ERROR' });
    }
    try {
      const tasks = await runtime.listTasks(workspaceID);
      return res.json({ tasks });
    } catch (error) {
      return respondWithError(res, error, 'Failed to load tasks');
    }
  });

  app.post('/api/workspaces/:id/tasks', async (req, res) => {
    const workspaceID = parseWorkspaceID(req);
    if (!workspaceID) {
      return res.status(400).json({ error: 'workspaceId is required', code: 'VALIDATION_ERROR' });
    }
    try {
      const task = await runtime.createTask(workspaceID, req.body ?? {});
      emitOpenChamberEvent(dependencies, 'openchamber:task.created', { workspaceId: workspaceID, task });
      return res.status(201).json({ task });
    } catch (error) {
      return respondWithError(res, error, 'Failed to create task');
    }
  });

  app.put('/api/workspaces/:id/tasks/:taskId', async (req, res) => {
    const workspaceID = parseWorkspaceID(req);
    const taskID = parseTaskID(req);
    if (!workspaceID) {
      return res.status(400).json({ error: 'workspaceId is required', code: 'VALIDATION_ERROR' });
    }
    if (!taskID) {
      return res.status(400).json({ error: 'taskId is required', code: 'VALIDATION_ERROR' });
    }
    try {
      const result = await runtime.updateTask(workspaceID, taskID, req.body ?? {});
      emitOpenChamberEvent(dependencies, 'openchamber:task.updated', {
        workspaceId: workspaceID,
        id: taskID,
        patch: result.patch,
      });
      return res.json({ task: result.task });
    } catch (error) {
      return respondWithError(res, error, 'Failed to update task');
    }
  });

  app.delete('/api/workspaces/:id/tasks/:taskId', async (req, res) => {
    const workspaceID = parseWorkspaceID(req);
    const taskID = parseTaskID(req);
    if (!workspaceID) {
      return res.status(400).json({ error: 'workspaceId is required', code: 'VALIDATION_ERROR' });
    }
    if (!taskID) {
      return res.status(400).json({ error: 'taskId is required', code: 'VALIDATION_ERROR' });
    }
    try {
      await runtime.deleteTask(workspaceID, taskID);
      emitOpenChamberEvent(dependencies, 'openchamber:task.deleted', { workspaceId: workspaceID, id: taskID });
      return res.json({ ok: true });
    } catch (error) {
      return respondWithError(res, error, 'Failed to delete task');
    }
  });
};
