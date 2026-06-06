import { getRuntimeUrlResolver } from './runtime-url';
import { subscribeRuntimeEndpointChanged } from './runtime-switch';
import type { Task, TaskManagerEvent, Workspace } from './tasks/types';

export type ScheduledTaskRanEvent = {
  type: 'scheduled-task-ran';
  projectId: string;
  taskId: string;
  ranAt: number;
  status: 'running' | 'success' | 'error';
  sessionId?: string;
};

export type WorkspaceCreatedEvent = {
  type: 'workspace.created';
  workspace: Workspace;
};

export type WorkspaceUpdatedEvent = {
  type: 'workspace.updated';
  id: string;
  patch: Record<string, unknown>;
};

export type WorkspaceDeletedEvent = {
  type: 'workspace.deleted';
  id: string;
};

export type TaskCreatedEvent = {
  type: 'task.created';
  workspaceId: string;
  task: Task;
};

export type TaskUpdatedEvent = {
  type: 'task.updated';
  workspaceId: string;
  id: string;
  patch: Record<string, unknown>;
};

export type TaskDeletedEvent = {
  type: 'task.deleted';
  workspaceId: string;
  id: string;
};

type OpenChamberEvent = ScheduledTaskRanEvent | TaskManagerEvent;
type Listener = (event: OpenChamberEvent) => void;

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let runtimeChangeUnsubscribe: (() => void) | null = null;
const listeners = new Set<Listener>();

const MAX_RECONNECT_DELAY_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

const clearHeartbeatTimer = () => {
  if (!heartbeatTimer) {
    return;
  }
  clearTimeout(heartbeatTimer);
  heartbeatTimer = null;
};

const scheduleReconnect = () => {
  if (reconnectTimer || listeners.size === 0) {
    return;
  }
  const delay = Math.min(1_000 * Math.pow(2, Math.min(reconnectAttempt, 5)), MAX_RECONNECT_DELAY_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempt += 1;
    connect();
  }, delay);
};

const cleanupSource = () => {
  clearHeartbeatTimer();
  if (eventSource) {
    eventSource.close();
  }
  eventSource = null;
};

const resetHeartbeatTimer = () => {
  clearHeartbeatTimer();
  if (listeners.size === 0) {
    return;
  }
  heartbeatTimer = setTimeout(() => {
    cleanupSource();
    scheduleReconnect();
  }, HEARTBEAT_TIMEOUT_MS);
};

const parseEnvelope = (raw: string): { type: string; properties: unknown } | null => {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const type = typeof parsed?.type === 'string' ? parsed.type : '';
    const properties = parsed?.properties;
    if (!type) {
      return null;
    }
    return { type, properties };
  } catch {
    return null;
  }
};

const dispatchFromEnvelope = (envelope: { type: string; properties: unknown }) => {
  if (envelope.type === 'openchamber:event-stream-ready') {
    reconnectAttempt = 0;
    return;
  }

  if (envelope.type === 'openchamber:heartbeat') {
    return;
  }

  const parsed = envelope.properties && typeof envelope.properties === 'object'
    ? envelope.properties as Record<string, unknown>
    : null;

  let nextEvent: OpenChamberEvent | null = null;
  if (envelope.type === 'openchamber:scheduled-task-ran') {
    const projectId = typeof parsed?.projectId === 'string' ? parsed.projectId : '';
    const taskId = typeof parsed?.taskId === 'string' ? parsed.taskId : '';
    const ranAt = typeof parsed?.ranAt === 'number' ? parsed.ranAt : Date.now();
    const rawStatus = parsed?.status;
    const status = rawStatus === 'running' || rawStatus === 'error' ? rawStatus : 'success';
    if (!projectId || !taskId) {
      return;
    }
    nextEvent = {
      type: 'scheduled-task-ran',
      projectId,
      taskId,
      ranAt,
      status,
      ...(typeof parsed?.sessionId === 'string' && parsed.sessionId.length > 0 ? { sessionId: parsed.sessionId } : {}),
    };
  } else if (envelope.type === 'openchamber:workspace.created' && parsed?.workspace && typeof parsed.workspace === 'object') {
    nextEvent = { type: 'workspace.created', workspace: parsed.workspace as Workspace };
  } else if (envelope.type === 'openchamber:workspace.updated') {
    const id = typeof parsed?.id === 'string' ? parsed.id : '';
    const patch = parsed?.patch && typeof parsed.patch === 'object' ? parsed.patch as Record<string, unknown> : null;
    if (!id || !patch) {
      return;
    }
    nextEvent = { type: 'workspace.updated', id, patch };
  } else if (envelope.type === 'openchamber:workspace.deleted') {
    const id = typeof parsed?.id === 'string' ? parsed.id : '';
    if (!id) {
      return;
    }
    nextEvent = { type: 'workspace.deleted', id };
  } else if (envelope.type === 'openchamber:task.created' && parsed?.task && typeof parsed.task === 'object') {
    const workspaceId = typeof parsed?.workspaceId === 'string' ? parsed.workspaceId : '';
    if (!workspaceId) {
      return;
    }
    nextEvent = { type: 'task.created', workspaceId, task: parsed.task as Task };
  } else if (envelope.type === 'openchamber:task.updated') {
    const workspaceId = typeof parsed?.workspaceId === 'string' ? parsed.workspaceId : '';
    const id = typeof parsed?.id === 'string' ? parsed.id : '';
    const patch = parsed?.patch && typeof parsed.patch === 'object' ? parsed.patch as Record<string, unknown> : null;
    if (!workspaceId || !id || !patch) {
      return;
    }
    nextEvent = { type: 'task.updated', workspaceId, id, patch };
  } else if (envelope.type === 'openchamber:task.deleted') {
    const workspaceId = typeof parsed?.workspaceId === 'string' ? parsed.workspaceId : '';
    const id = typeof parsed?.id === 'string' ? parsed.id : '';
    if (!workspaceId || !id) {
      return;
    }
    nextEvent = { type: 'task.deleted', workspaceId, id };
  }

  if (!nextEvent) {
    return;
  }
  for (const listener of listeners) {
    listener(nextEvent);
  }
};

const connect = () => {
  if (typeof window === 'undefined' || listeners.size === 0) {
    return;
  }
  if (typeof EventSource !== 'function') {
    return;
  }

  if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
    return;
  }

  cleanupSource();

  const source = new EventSource(getRuntimeUrlResolver().sse('/api/openchamber/events'));
  source.onopen = () => {
    resetHeartbeatTimer();
  };
  source.onmessage = (event) => {
    resetHeartbeatTimer();
    const envelope = parseEnvelope(event.data);
    if (!envelope) {
      return;
    }
    dispatchFromEnvelope(envelope);
  };

  source.onerror = () => {
    cleanupSource();
    scheduleReconnect();
  };

  eventSource = source;
};

const ensureRuntimeChangeSubscription = () => {
  if (runtimeChangeUnsubscribe || typeof window === 'undefined') return;
  runtimeChangeUnsubscribe = subscribeRuntimeEndpointChanged(() => {
    cleanupSource();
    reconnectAttempt = 0;
    connect();
  });
};

const cleanupRuntimeChangeSubscription = () => {
  runtimeChangeUnsubscribe?.();
  runtimeChangeUnsubscribe = null;
};

export const subscribeOpenchamberEvents = (listener: Listener): (() => void) => {
  listeners.add(listener);
  ensureRuntimeChangeSubscription();
  connect();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reconnectAttempt = 0;
      cleanupSource();
      cleanupRuntimeChangeSubscription();
    }
  };
};
