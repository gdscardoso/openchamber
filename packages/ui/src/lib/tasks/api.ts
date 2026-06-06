import { runtimeFetch } from '@/lib/runtime-fetch';
import type { Task, TaskInput, Workspace } from './types';

type ApiError = Error & { code?: string };

const readJsonOrThrow = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with ${response.status}`) as ApiError;
    if (typeof payload?.code === 'string') {
      error.code = payload.code;
    }
    throw error;
  }
  return payload as T;
};

export const listWorkspaces = async (): Promise<Workspace[]> => {
  const response = await runtimeFetch('/api/workspaces');
  const payload = await readJsonOrThrow<{ workspaces: Workspace[] }>(response);
  return Array.isArray(payload.workspaces) ? payload.workspaces : [];
};

export const createWorkspace = async (input: { name: string }): Promise<Workspace> => {
  const response = await runtimeFetch('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await readJsonOrThrow<{ workspace: Workspace }>(response);
  return payload.workspace;
};

export const updateWorkspace = async (workspaceId: string, patch: Partial<Workspace>): Promise<Workspace> => {
  const response = await runtimeFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const payload = await readJsonOrThrow<{ workspace: Workspace }>(response);
  return payload.workspace;
};

export const deleteWorkspace = async (workspaceId: string): Promise<void> => {
  const response = await runtimeFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: 'DELETE',
  });
  await readJsonOrThrow(response);
};

export const listWorkspaceTasks = async (workspaceId: string): Promise<Task[]> => {
  const response = await runtimeFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`);
  const payload = await readJsonOrThrow<{ tasks: Task[] }>(response);
  return Array.isArray(payload.tasks) ? payload.tasks : [];
};

export const createWorkspaceTask = async (workspaceId: string, input: TaskInput): Promise<Task> => {
  const response = await runtimeFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await readJsonOrThrow<{ task: Task }>(response);
  return payload.task;
};

export const updateWorkspaceTask = async (workspaceId: string, taskId: string, patch: Partial<Task>): Promise<Task> => {
  const response = await runtimeFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const payload = await readJsonOrThrow<{ task: Task }>(response);
  return payload.task;
};

export const deleteWorkspaceTask = async (workspaceId: string, taskId: string): Promise<void> => {
  const response = await runtimeFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
  await readJsonOrThrow(response);
};
