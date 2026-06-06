const WORKSPACES_VERSION = 1;
const TASKS_VERSION = 1;
const MAX_WORKSPACE_NAME_LENGTH = 80;
const MAX_COLOR_LENGTH = 80;
const MAX_TASK_TITLE_LENGTH = 200;
const MAX_TASK_CONTENT_LENGTH = 20_000;
const MAX_TASK_TAG_LENGTH = 60;
const MAX_TASK_TAGS = 20;
const MAX_BRANCH_LENGTH = 200;
const DEFAULT_WORKSPACE_NAME = 'Default';
const TASK_STATUSES = new Set(['todo', 'in_progress', 'done']);

class TasksRuntimeError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.name = 'TasksRuntimeError';
    this.status = status;
    this.code = code;
  }
}

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const clampInteger = (value, fallback = 0) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
};

const safeArray = (value) => Array.isArray(value) ? value : [];

const sanitizeFileID = (value) => {
  const normalized = asNonEmptyString(value) || 'invalid';
  return normalized.replace(/[^A-Za-z0-9._-]+/g, '_');
};

const uniqueStrings = (values) => {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = asNonEmptyString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const shallowPatch = (previous, next) => {
  const patch = {};
  for (const key of Object.keys(next)) {
    if (previous[key] !== next[key]) {
      patch[key] = next[key];
    }
  }
  return patch;
};

const normalizeWorkspaceForStorage = (value, fallback = null) => {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const id = asNonEmptyString(source.id) || asNonEmptyString(fallbackSource.id) || globalThis.crypto.randomUUID();
  const nameRaw = asNonEmptyString(source.name) || asNonEmptyString(fallbackSource.name) || DEFAULT_WORKSPACE_NAME;
  const name = nameRaw.length > MAX_WORKSPACE_NAME_LENGTH ? nameRaw.slice(0, MAX_WORKSPACE_NAME_LENGTH) : nameRaw;
  const colorRaw = asNonEmptyString(source.color) || asNonEmptyString(fallbackSource.color);
  const color = colorRaw ? colorRaw.slice(0, MAX_COLOR_LENGTH) : undefined;
  const projectIDs = uniqueStrings(safeArray(source.projectIDs).length > 0 ? source.projectIDs : fallbackSource.projectIDs || []);
  const createdAt = clampInteger(source.createdAt, clampInteger(fallbackSource.createdAt, Date.now()));
  return {
    id,
    name,
    ...(color ? { color } : {}),
    projectIDs,
    createdAt,
  };
};

const normalizeStatus = (value, fallback = 'todo') => {
  return TASK_STATUSES.has(value) ? value : fallback;
};

const normalizeTaskTags = (value) => {
  const tags = [];
  const seen = new Set();
  for (const entry of safeArray(value)) {
    const tag = asNonEmptyString(entry);
    if (!tag) {
      continue;
    }
    const normalized = tag.length > MAX_TASK_TAG_LENGTH ? tag.slice(0, MAX_TASK_TAG_LENGTH) : tag;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(normalized);
    if (tags.length >= MAX_TASK_TAGS) {
      break;
    }
  }
  return tags;
};

const normalizeOptionalField = (value, maxLength) => {
  const normalized = asNonEmptyString(value);
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
};

const applyTaskStatusTransition = (task, nextStatus, now) => {
  if (nextStatus === 'in_progress' && task.startedAt == null) {
    task.startedAt = now;
  }
  if (nextStatus === 'done') {
    task.completedAt = now;
  } else if (task.status === 'done' && nextStatus !== 'done') {
    task.completedAt = null;
  }
  // Moving back to "todo" resets progress timestamps so the task leaves the daily view.
  if (nextStatus === 'todo') {
    task.startedAt = null;
    task.completedAt = null;
  }
  task.status = nextStatus;
};

const normalizeTaskForStorage = (value, options = {}) => {
  const {
    existingTask = null,
    allowCreate = false,
    now = Date.now(),
    allowPartial = false,
    workspaceProjectIDs = null,
    preserveStoredTimestamps = false,
  } = options;
  const source = value && typeof value === 'object' ? value : {};
  const base = existingTask ? { ...existingTask } : null;

  if (!allowCreate && !base) {
    throw new TasksRuntimeError('Task not found', 404, 'TASK_NOT_FOUND');
  }

  const sourceID = asNonEmptyString(source.id);
  const task = base || {
    id: sourceID || globalThis.crypto.randomUUID(),
    title: '',
    content: '',
    tags: [],
    projectId: null,
    branch: null,
    sessionId: null,
    status: 'todo',
    order: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };

  if (!allowPartial || Object.prototype.hasOwnProperty.call(source, 'title')) {
    const title = normalizeOptionalField(source.title, MAX_TASK_TITLE_LENGTH);
    if (!title) {
      throw new TasksRuntimeError('title is required', 400, 'VALIDATION_ERROR');
    }
    task.title = title;
  }

  if (!allowPartial || Object.prototype.hasOwnProperty.call(source, 'content')) {
    const rawContent = typeof source.content === 'string' ? source.content : '';
    task.content = rawContent.length > MAX_TASK_CONTENT_LENGTH ? rawContent.slice(0, MAX_TASK_CONTENT_LENGTH) : rawContent;
  }

  if (!allowPartial || Object.prototype.hasOwnProperty.call(source, 'tags')) {
    task.tags = normalizeTaskTags(source.tags);
  }

  if (!allowPartial || Object.prototype.hasOwnProperty.call(source, 'projectId')) {
    const projectId = normalizeOptionalField(source.projectId, 400);
    if (projectId && Array.isArray(workspaceProjectIDs) && !workspaceProjectIDs.includes(projectId)) {
      throw new TasksRuntimeError('projectId must belong to workspace', 409, 'PROJECT_NOT_IN_WORKSPACE');
    }
    task.projectId = projectId;
  }

  if (!allowPartial || Object.prototype.hasOwnProperty.call(source, 'branch')) {
    task.branch = normalizeOptionalField(source.branch, MAX_BRANCH_LENGTH);
  }

  if (!allowPartial || Object.prototype.hasOwnProperty.call(source, 'sessionId')) {
    task.sessionId = normalizeOptionalField(source.sessionId, 400);
  }

  if (!allowPartial || Object.prototype.hasOwnProperty.call(source, 'order')) {
    task.order = clampInteger(source.order, task.order);
  }

  if (!allowPartial || Object.prototype.hasOwnProperty.call(source, 'status')) {
    const rawStatus = source.status;
    if (rawStatus != null && !TASK_STATUSES.has(rawStatus)) {
      throw new TasksRuntimeError('status must be todo, in_progress, or done', 400, 'VALIDATION_ERROR');
    }
    const nextStatus = normalizeStatus(rawStatus, task.status);
    if (preserveStoredTimestamps) {
      task.status = nextStatus;
    } else {
      applyTaskStatusTransition(task, nextStatus, now);
    }
  }

  task.createdAt = clampInteger(task.createdAt, now);
  task.updatedAt = preserveStoredTimestamps ? clampInteger(source.updatedAt, now) : now;
  task.startedAt = typeof task.startedAt === 'number' ? clampInteger(task.startedAt, now) : null;
  task.completedAt = typeof task.completedAt === 'number' ? clampInteger(task.completedAt, now) : null;

  // Invariant backfill so the daily view (derived from startedAt/completedAt)
  // stays consistent for legacy tasks whose timestamps were never recorded.
  if (task.status === 'in_progress' && task.startedAt == null) {
    task.startedAt = task.updatedAt;
  }
  if (task.status === 'done') {
    if (task.completedAt == null) {
      task.completedAt = task.updatedAt;
    }
    if (task.startedAt == null) {
      task.startedAt = task.completedAt;
    }
  }
  return task;
};

const sortTasksForStorage = (tasks) => {
  return tasks.slice().sort((left, right) => {
    if (left.status !== right.status) {
      return left.status.localeCompare(right.status);
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.createdAt - right.createdAt;
  });
};

export const createTasksRuntime = (deps) => {
  const {
    fsPromises,
    path,
    openchamberDataDir,
    listProjectIDs,
  } = deps;

  const writeLocks = new Map();

  const workspacesFilePath = path.join(openchamberDataDir, 'workspaces.json');
  const workspaceTasksDirPath = path.join(openchamberDataDir, 'workspace-tasks');

  const withWriteLock = async (key, mutate) => {
    const normalizedKey = sanitizeFileID(key);
    const previous = writeLocks.get(normalizedKey) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const chained = previous.finally(() => next);
    writeLocks.set(normalizedKey, chained);
    await previous;
    try {
      return await mutate();
    } finally {
      release();
      if (writeLocks.get(normalizedKey) === chained) {
        writeLocks.delete(normalizedKey);
      }
    }
  };

  const writeJsonAtomic = async (filePath, value) => {
    const parentDirectory = path.dirname(filePath);
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fsPromises.mkdir(parentDirectory, { recursive: true });
    await fsPromises.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fsPromises.rename(temporaryPath, filePath);
  };

  const readJsonFile = async (filePath, fallback) => {
    try {
      const raw = await fsPromises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return fallback;
      }
      throw error;
    }
  };

  const resolveWorkspaceTasksPath = (workspaceID) => {
    return path.join(workspaceTasksDirPath, `${sanitizeFileID(workspaceID)}.json`);
  };

  const readRawWorkspaces = async () => {
    return readJsonFile(workspacesFilePath, {});
  };

  const writeWorkspaces = async (workspaces) => {
    await writeJsonAtomic(workspacesFilePath, {
      version: WORKSPACES_VERSION,
      workspaces,
    });
  };

  const readRawTasks = async (workspaceID) => {
    return readJsonFile(resolveWorkspaceTasksPath(workspaceID), {});
  };

  const writeTasks = async (workspaceID, tasks) => {
    await writeJsonAtomic(resolveWorkspaceTasksPath(workspaceID), {
      version: TASKS_VERSION,
      tasks: sortTasksForStorage(tasks),
    });
  };

  const normalizeWorkspaceCollection = (value) => {
    const result = [];
    const seenWorkspaceIDs = new Set();
    for (const item of safeArray(value)) {
      try {
        const workspace = normalizeWorkspaceForStorage(item);
        if (seenWorkspaceIDs.has(workspace.id)) {
          continue;
        }
        seenWorkspaceIDs.add(workspace.id);
        result.push(workspace);
      } catch {
      }
    }
    return result;
  };

  const normalizeTaskCollection = (value, workspaceProjectIDs) => {
    const result = [];
    const seenTaskIDs = new Set();
    for (const item of safeArray(value)) {
      try {
        const task = normalizeTaskForStorage(item, {
          allowCreate: true,
          now: clampInteger(item?.updatedAt, Date.now()),
          workspaceProjectIDs,
          preserveStoredTimestamps: true,
        });
        if (seenTaskIDs.has(task.id)) {
          continue;
        }
        seenTaskIDs.add(task.id);
        result.push(task);
      } catch {
      }
    }
    return sortTasksForStorage(result);
  };

  const ensureDefaultWorkspaceState = (workspaces, allProjectIDs) => {
    const projectIDs = uniqueStrings(allProjectIDs);
    const next = workspaces.map((workspace) => ({ ...workspace, projectIDs: workspace.projectIDs.slice() }));
    const assigned = new Set();
    for (const workspace of next) {
      workspace.projectIDs = workspace.projectIDs.filter((projectID) => {
        if (assigned.has(projectID)) {
          return false;
        }
        assigned.add(projectID);
        return true;
      });
    }

    let defaultWorkspace = next.find((workspace) => workspace.name === DEFAULT_WORKSPACE_NAME) || null;
    if (!defaultWorkspace) {
      defaultWorkspace = normalizeWorkspaceForStorage({
        name: DEFAULT_WORKSPACE_NAME,
        projectIDs: [],
      });
      next.unshift(defaultWorkspace);
    }

    let changed = workspaces.length !== next.length;
    for (const projectID of projectIDs) {
      if (!assigned.has(projectID)) {
        defaultWorkspace.projectIDs.push(projectID);
        assigned.add(projectID);
        changed = true;
      }
    }

    return {
      workspaces: next,
      changed,
      defaultWorkspaceID: defaultWorkspace.id,
    };
  };

  const readNormalizedWorkspaces = async (persistChanges = true) => {
    const raw = await readRawWorkspaces();
    const stored = normalizeWorkspaceCollection(raw.workspaces);
    const projectIDs = typeof listProjectIDs === 'function' ? await listProjectIDs() : [];
    const normalized = ensureDefaultWorkspaceState(stored, projectIDs);
    let result = normalized.workspaces;
    if (persistChanges && normalized.changed) {
      await withWriteLock('workspaces', async () => {
        const fresh = await readRawWorkspaces();
        const freshNormalized = ensureDefaultWorkspaceState(normalizeWorkspaceCollection(fresh.workspaces), projectIDs);
        await writeWorkspaces(freshNormalized.workspaces);
        result = freshNormalized.workspaces;
      });
    }
    return result;
  };

  const getWorkspace = async (workspaceID) => {
    const normalizedID = asNonEmptyString(workspaceID);
    if (!normalizedID) {
      throw new TasksRuntimeError('workspaceId is required', 400, 'VALIDATION_ERROR');
    }
    const workspaces = await readNormalizedWorkspaces();
    return workspaces.find((workspace) => workspace.id === normalizedID) || null;
  };

  const listWorkspaces = async () => {
    return readNormalizedWorkspaces();
  };

  const createWorkspace = async (input) => {
    return withWriteLock('workspaces', async () => {
      const current = await readNormalizedWorkspaces(false);
      if (!asNonEmptyString(input?.name)) {
        throw new TasksRuntimeError('name is required', 400, 'VALIDATION_ERROR');
      }
      const workspace = normalizeWorkspaceForStorage(input);
      const nextWorkspaces = current.map((entry) => ({ ...entry, projectIDs: entry.projectIDs.filter((projectID) => !workspace.projectIDs.includes(projectID)) }));
      nextWorkspaces.push(workspace);
      await writeWorkspaces(nextWorkspaces);
      return workspace;
    });
  };

  const updateWorkspace = async (workspaceID, patch) => {
    return withWriteLock('workspaces', async () => {
      const current = await readNormalizedWorkspaces(false);
      const index = current.findIndex((workspace) => workspace.id === workspaceID);
      if (index === -1) {
        throw new TasksRuntimeError('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
      }
      const previous = current[index];
      const nextWorkspace = normalizeWorkspaceForStorage({
        ...previous,
        ...patch,
        id: previous.id,
      }, previous);

      const nextWorkspaces = current.map((workspace, entryIndex) => {
        if (entryIndex === index) {
          return nextWorkspace;
        }
        return {
          ...workspace,
          projectIDs: workspace.projectIDs.filter((projectID) => !nextWorkspace.projectIDs.includes(projectID)),
        };
      });
      await writeWorkspaces(nextWorkspaces);
      return {
        workspace: nextWorkspace,
        patch: shallowPatch(previous, nextWorkspace),
      };
    });
  };

  const deleteWorkspace = async (workspaceID) => {
    return withWriteLock('workspaces', async () => {
      const current = await readNormalizedWorkspaces(false);
      const target = current.find((workspace) => workspace.id === workspaceID) || null;
      if (!target) {
        throw new TasksRuntimeError('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
      }
      if (target.name === DEFAULT_WORKSPACE_NAME) {
        throw new TasksRuntimeError('Default workspace cannot be deleted', 409, 'DEFAULT_WORKSPACE_LOCKED');
      }

      const remaining = current.filter((workspace) => workspace.id !== workspaceID);
      const defaultWorkspace = remaining.find((workspace) => workspace.name === DEFAULT_WORKSPACE_NAME) || remaining[0] || null;
      if (defaultWorkspace && target.projectIDs.length > 0) {
        defaultWorkspace.projectIDs = uniqueStrings(defaultWorkspace.projectIDs.concat(target.projectIDs));
      }
      await writeWorkspaces(remaining);
      try {
        await fsPromises.unlink(resolveWorkspaceTasksPath(workspaceID));
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
          throw error;
        }
      }
      return target;
    });
  };

  const listTasks = async (workspaceID) => {
    const workspace = await getWorkspace(workspaceID);
    if (!workspace) {
      throw new TasksRuntimeError('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
    }
    const raw = await readRawTasks(workspace.id);
    const tasks = normalizeTaskCollection(raw.tasks, workspace.projectIDs);
    return tasks;
  };

  const createTask = async (workspaceID, input) => {
    return withWriteLock(`tasks:${workspaceID}`, async () => {
      const workspace = await getWorkspace(workspaceID);
      if (!workspace) {
        throw new TasksRuntimeError('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
      }
      const current = await listTasks(workspaceID);
      const task = normalizeTaskForStorage(input, {
        allowCreate: true,
        now: Date.now(),
        workspaceProjectIDs: workspace.projectIDs,
      });
      const nextTasks = current.concat(task);
      await writeTasks(workspace.id, nextTasks);
      return task;
    });
  };

  const updateTask = async (workspaceID, taskID, patch) => {
    return withWriteLock(`tasks:${workspaceID}`, async () => {
      const workspace = await getWorkspace(workspaceID);
      if (!workspace) {
        throw new TasksRuntimeError('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
      }
      const current = await listTasks(workspaceID);
      const index = current.findIndex((task) => task.id === taskID);
      if (index === -1) {
        throw new TasksRuntimeError('Task not found', 404, 'TASK_NOT_FOUND');
      }
      const previous = current[index];
      const nextTask = normalizeTaskForStorage(patch, {
        existingTask: previous,
        allowPartial: true,
        now: Date.now(),
        workspaceProjectIDs: workspace.projectIDs,
      });
      const nextTasks = current.slice();
      nextTasks[index] = nextTask;
      await writeTasks(workspace.id, nextTasks);
      return {
        task: nextTask,
        patch: shallowPatch(previous, nextTask),
      };
    });
  };

  const deleteTask = async (workspaceID, taskID) => {
    return withWriteLock(`tasks:${workspaceID}`, async () => {
      const workspace = await getWorkspace(workspaceID);
      if (!workspace) {
        throw new TasksRuntimeError('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
      }
      const current = await listTasks(workspaceID);
      const nextTasks = current.filter((task) => task.id !== taskID);
      if (nextTasks.length === current.length) {
        throw new TasksRuntimeError('Task not found', 404, 'TASK_NOT_FOUND');
      }
      await writeTasks(workspace.id, nextTasks);
    });
  };

  return {
    TasksRuntimeError,
    listWorkspaces,
    getWorkspace,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    listTasks,
    createTask,
    updateTask,
    deleteTask,
  };
};

export {
  DEFAULT_WORKSPACE_NAME,
  TASK_STATUSES,
  TasksRuntimeError,
};
