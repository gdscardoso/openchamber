import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { getSafeStorage } from './utils/safeStorage';
import type { TaskStatus } from '@/lib/tasks/types';

type ViewMode = 'kanban' | 'daily';

type TaskModalDraft = {
  workspaceId?: string | null;
  projectId?: string | null;
  branch?: string | null;
  sessionId?: string | null;
  status?: TaskStatus;
};

type TaskManagerUIStore = {
  activeWorkspaceId: string | null;
  viewMode: ViewMode;
  projectFilterByWorkspace: Record<string, string | null>;
  isTaskModalOpen: boolean;
  editingTaskId: string | null;
  taskModalDraft: TaskModalDraft | null;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setProjectFilter: (workspaceId: string, projectId: string | null) => void;
  openCreateTaskModal: (draft?: TaskModalDraft | null) => void;
  openEditTaskModal: (taskId: string) => void;
  closeTaskModal: () => void;
};

export const useTaskManagerUIStore = create<TaskManagerUIStore>()(
  devtools(
    persist(
      (set) => ({
        activeWorkspaceId: null,
        viewMode: 'kanban',
        projectFilterByWorkspace: {},
        isTaskModalOpen: false,
        editingTaskId: null,
        taskModalDraft: null,
        setActiveWorkspaceId: (workspaceId) => set((state) => state.activeWorkspaceId === workspaceId ? state : { activeWorkspaceId: workspaceId }),
        setViewMode: (mode) => set((state) => state.viewMode === mode ? state : { viewMode: mode }),
        setProjectFilter: (workspaceId, projectId) => set((state) => ({
          projectFilterByWorkspace: {
            ...state.projectFilterByWorkspace,
            [workspaceId]: projectId,
          },
        })),
        openCreateTaskModal: (draft) => set({
          isTaskModalOpen: true,
          editingTaskId: null,
          taskModalDraft: draft ?? null,
        }),
        openEditTaskModal: (taskId) => set({
          isTaskModalOpen: true,
          editingTaskId: taskId,
          taskModalDraft: null,
        }),
        closeTaskModal: () => set({
          isTaskModalOpen: false,
          editingTaskId: null,
          taskModalDraft: null,
        }),
      }),
      {
        name: 'openchamber-task-manager-ui',
        version: 1,
        storage: createJSONStorage(() => getSafeStorage()),
        partialize: (state) => ({
          activeWorkspaceId: state.activeWorkspaceId,
          viewMode: state.viewMode,
          projectFilterByWorkspace: state.projectFilterByWorkspace,
        }),
      },
    ),
    { name: 'TaskManagerUIStore' },
  ),
);
