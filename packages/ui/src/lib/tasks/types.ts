export type TaskStatus = 'todo' | 'in_progress' | 'done';

export type Workspace = {
  id: string;
  name: string;
  color?: string;
  projectIDs: string[];
  createdAt: number;
};

export type Task = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  projectId: string | null;
  branch: string | null;
  sessionId: string | null;
  status: TaskStatus;
  order: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type WorkspaceCreatedEvent = {
  type: 'workspace.created';
  workspace: Workspace;
};

export type WorkspaceUpdatedEvent = {
  type: 'workspace.updated';
  id: string;
  patch: Partial<Workspace>;
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
  patch: Partial<Task>;
};

export type TaskDeletedEvent = {
  type: 'task.deleted';
  workspaceId: string;
  id: string;
};

export type TaskManagerEvent =
  | WorkspaceCreatedEvent
  | WorkspaceUpdatedEvent
  | WorkspaceDeletedEvent
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskDeletedEvent;

export type TaskInput = {
  title: string;
  content?: string;
  tags?: string[];
  projectId?: string | null;
  branch?: string | null;
  sessionId?: string | null;
  status?: TaskStatus;
  order?: number;
};
