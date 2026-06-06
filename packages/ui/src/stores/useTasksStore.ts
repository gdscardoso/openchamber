import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import * as tasksApi from '@/lib/tasks/api';
import { sortTasks, withOptimisticStatusTimestamps } from '@/lib/tasks/helpers';
import type { Task, TaskInput, TaskManagerEvent } from '@/lib/tasks/types';

type TasksStore = {
  tasksByWorkspaceId: Record<string, Task[]>;
  loadingByWorkspaceId: Record<string, boolean>;
  errorByWorkspaceId: Record<string, string | null>;
  loadWorkspaceTasks: (workspaceId: string) => Promise<void>;
  createTask: (workspaceId: string, input: TaskInput) => Promise<Task>;
  updateTask: (workspaceId: string, taskId: string, patch: Partial<Task>) => Promise<Task>;
  deleteTask: (workspaceId: string, taskId: string) => Promise<void>;
  applyEvent: (event: TaskManagerEvent) => void;
};

const EMPTY_TASKS: Task[] = [];

const mergeTask = (task: Task, patch: Partial<Task>): Task => {
  return { ...task, ...patch };
};

const upsertTaskList = (tasks: Task[], nextTask: Task): Task[] => {
  const index = tasks.findIndex((task) => task.id === nextTask.id);
  if (index === -1) {
    return sortTasks(tasks.concat(nextTask));
  }
  const next = tasks.slice();
  next[index] = nextTask;
  return sortTasks(next);
};

export const useTasksStore = create<TasksStore>()(
  devtools((set, get) => ({
    tasksByWorkspaceId: {},
    loadingByWorkspaceId: {},
    errorByWorkspaceId: {},
    loadWorkspaceTasks: async (workspaceId) => {
      set((state) => ({
        loadingByWorkspaceId: { ...state.loadingByWorkspaceId, [workspaceId]: true },
        errorByWorkspaceId: { ...state.errorByWorkspaceId, [workspaceId]: null },
      }));
      try {
        const tasks = await tasksApi.listWorkspaceTasks(workspaceId);
        set((state) => ({
          tasksByWorkspaceId: { ...state.tasksByWorkspaceId, [workspaceId]: sortTasks(tasks) },
          loadingByWorkspaceId: { ...state.loadingByWorkspaceId, [workspaceId]: false },
          errorByWorkspaceId: { ...state.errorByWorkspaceId, [workspaceId]: null },
        }));
      } catch (error) {
        set((state) => ({
          loadingByWorkspaceId: { ...state.loadingByWorkspaceId, [workspaceId]: false },
          errorByWorkspaceId: { ...state.errorByWorkspaceId, [workspaceId]: error instanceof Error ? error.message : 'Failed to load tasks' },
        }));
      }
    },
    createTask: async (workspaceId, input) => {
      const task = await tasksApi.createWorkspaceTask(workspaceId, input);
      set((state) => ({
        tasksByWorkspaceId: {
          ...state.tasksByWorkspaceId,
          [workspaceId]: upsertTaskList(state.tasksByWorkspaceId[workspaceId] ?? [], task),
        },
      }));
      return task;
    },
    updateTask: async (workspaceId, taskId, patch) => {
      const previousTasks = get().tasksByWorkspaceId[workspaceId] ?? [];
      const previousTask = previousTasks.find((task) => task.id === taskId) ?? null;
      if (!previousTask) {
        throw new Error('Task not found');
      }
      const optimisticTask = mergeTask(previousTask, withOptimisticStatusTimestamps(previousTask, patch));
      set((state) => ({
        tasksByWorkspaceId: {
          ...state.tasksByWorkspaceId,
          [workspaceId]: upsertTaskList(state.tasksByWorkspaceId[workspaceId] ?? [], optimisticTask),
        },
      }));
      try {
        const task = await tasksApi.updateWorkspaceTask(workspaceId, taskId, patch);
        set((state) => ({
          tasksByWorkspaceId: {
            ...state.tasksByWorkspaceId,
            [workspaceId]: upsertTaskList(state.tasksByWorkspaceId[workspaceId] ?? [], task),
          },
        }));
        return task;
      } catch (error) {
        set((state) => ({
          tasksByWorkspaceId: {
            ...state.tasksByWorkspaceId,
            [workspaceId]: upsertTaskList(state.tasksByWorkspaceId[workspaceId] ?? [], previousTask),
          },
        }));
        throw error;
      }
    },
    deleteTask: async (workspaceId, taskId) => {
      const previousTasks = get().tasksByWorkspaceId[workspaceId] ?? [];
      set((state) => ({
        tasksByWorkspaceId: {
          ...state.tasksByWorkspaceId,
          [workspaceId]: (state.tasksByWorkspaceId[workspaceId] ?? []).filter((task) => task.id !== taskId),
        },
      }));
      try {
        await tasksApi.deleteWorkspaceTask(workspaceId, taskId);
      } catch (error) {
        set((state) => ({
          tasksByWorkspaceId: {
            ...state.tasksByWorkspaceId,
            [workspaceId]: previousTasks,
          },
        }));
        throw error;
      }
    },
    applyEvent: (event) => {
      if (event.type === 'task.created') {
        set((state) => ({
          tasksByWorkspaceId: {
            ...state.tasksByWorkspaceId,
            [event.workspaceId]: upsertTaskList(state.tasksByWorkspaceId[event.workspaceId] ?? [], event.task),
          },
        }));
        return;
      }
      if (event.type === 'task.updated') {
        set((state) => {
          const current = state.tasksByWorkspaceId[event.workspaceId] ?? [];
          const existing = current.find((task) => task.id === event.id);
          if (!existing) {
            return state;
          }
          return {
            tasksByWorkspaceId: {
              ...state.tasksByWorkspaceId,
              [event.workspaceId]: upsertTaskList(current, mergeTask(existing, event.patch)),
            },
          };
        });
        return;
      }
      if (event.type === 'task.deleted') {
        set((state) => ({
          tasksByWorkspaceId: {
            ...state.tasksByWorkspaceId,
            [event.workspaceId]: (state.tasksByWorkspaceId[event.workspaceId] ?? []).filter((task) => task.id !== event.id),
          },
        }));
      }
    },
  }), { name: 'TasksStore' }),
);

export const useTasksForWorkspace = (workspaceId: string | null) => {
  return useTasksStore((state) => workspaceId ? (state.tasksByWorkspaceId[workspaceId] ?? EMPTY_TASKS) : EMPTY_TASKS);
};

export const useTask = (workspaceId: string | null, taskId: string | null) => {
  return useTasksStore((state) => {
    if (!workspaceId || !taskId) {
      return null;
    }
    return (state.tasksByWorkspaceId[workspaceId] ?? []).find((task) => task.id === taskId) ?? null;
  });
};
