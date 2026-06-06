import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import * as tasksApi from '@/lib/tasks/api';
import type { TaskManagerEvent, Workspace } from '@/lib/tasks/types';
import { useTaskManagerUIStore } from './useTaskManagerUIStore';

type WorkspacesStore = {
  workspaces: Workspace[];
  isLoading: boolean;
  error: string | null;
  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  updateWorkspace: (workspaceId: string, patch: Partial<Workspace>) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  applyEvent: (event: TaskManagerEvent) => void;
};

const sortWorkspaces = (workspaces: Workspace[]): Workspace[] => {
  return workspaces.slice().sort((left, right) => left.createdAt - right.createdAt);
};

export const useWorkspacesStore = create<WorkspacesStore>()(
  devtools((set, get) => ({
    workspaces: [],
    isLoading: false,
    error: null,
    loadWorkspaces: async () => {
      set({ isLoading: true, error: null });
      try {
        const workspaces = await tasksApi.listWorkspaces();
        set({ workspaces: sortWorkspaces(workspaces), isLoading: false, error: null });
      } catch (error) {
        set({ isLoading: false, error: error instanceof Error ? error.message : 'Failed to load workspaces' });
      }
    },
    createWorkspace: async (name) => {
      const workspace = await tasksApi.createWorkspace({ name });
      set((state) => ({ workspaces: sortWorkspaces(state.workspaces.concat(workspace)) }));
      useTaskManagerUIStore.getState().setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    updateWorkspace: async (workspaceId, patch) => {
      const workspace = await tasksApi.updateWorkspace(workspaceId, patch);
      set((state) => ({
        workspaces: sortWorkspaces(state.workspaces.map((entry) => entry.id === workspaceId ? workspace : entry)),
      }));
    },
    deleteWorkspace: async (workspaceId) => {
      await tasksApi.deleteWorkspace(workspaceId);
      set((state) => ({ workspaces: state.workspaces.filter((entry) => entry.id !== workspaceId) }));
      const uiState = useTaskManagerUIStore.getState();
      if (uiState.activeWorkspaceId === workspaceId) {
        const next = get().workspaces[0]?.id ?? null;
        uiState.setActiveWorkspaceId(next);
      }
    },
    applyEvent: (event) => {
      if (event.type === 'workspace.created') {
        set((state) => ({ workspaces: sortWorkspaces(state.workspaces.concat(event.workspace)) }));
        return;
      }
      if (event.type === 'workspace.updated') {
        set((state) => ({
          workspaces: sortWorkspaces(state.workspaces.map((workspace) => workspace.id === event.id ? { ...workspace, ...event.patch } : workspace)),
        }));
        return;
      }
      if (event.type === 'workspace.deleted') {
        set((state) => ({ workspaces: state.workspaces.filter((workspace) => workspace.id !== event.id) }));
      }
    },
  }), { name: 'WorkspacesStore' }),
);
