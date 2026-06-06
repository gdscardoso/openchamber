import React from 'react';
import { DndContext, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { deriveDailySections, getTasksForStatus, TASK_STATUS_ORDER } from '@/lib/tasks/helpers';
import type { ProjectEntry } from '@/lib/api/types';
import type { Task, TaskStatus } from '@/lib/tasks/types';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useTaskManagerUIStore } from '@/stores/useTaskManagerUIStore';
import { useTasksForWorkspace, useTasksStore } from '@/stores/useTasksStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useGitBranchLabel } from '@/stores/useGitStore';
import { TaskCard } from '@/components/tasks/TaskCard';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui';

const EMPTY_VALUE = '__all';

const STATUS_LABEL_KEYS: Record<TaskStatus, 'tasks.status.todo' | 'tasks.status.in_progress' | 'tasks.status.done'> = {
  todo: 'tasks.status.todo',
  in_progress: 'tasks.status.in_progress',
  done: 'tasks.status.done',
};

const formatDateInputValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const ColumnDropZone: React.FC<{ id: string; title: string; tasks: Task[]; projectsById: Map<string, ProjectEntry>; onOpen: (taskId: string) => void; onCreate?: (status: TaskStatus) => void; createLabel?: string; emptyLabel: string; }> = ({ id, title, tasks, projectsById, onOpen, onCreate, createLabel, emptyLabel }) => {
  const { isOver, setNodeRef } = useDroppable({ id });
  const status = TASK_STATUS_ORDER.includes(id as TaskStatus) ? id as TaskStatus : null;
  return (
    <div ref={setNodeRef} className={cn('flex min-h-56 flex-col gap-3 rounded-xl border border-border bg-[var(--surface-muted)] p-3', isOver && 'bg-[var(--interactive-hover)]')}>
      <div className="flex items-center justify-between">
        <h3 className="typography-ui-label text-foreground">{title}</h3>
        <div className="flex items-center gap-1">
          {status && onCreate ? (
            <button
              type="button"
              aria-label={createLabel}
              title={createLabel}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
              onClick={() => onCreate(status)}
            >
              <Icon name="add-circle" className="h-4 w-4" />
            </button>
          ) : null}
          <span className="rounded-md bg-[var(--surface-elevated)] px-2 py-1 typography-micro text-muted-foreground">{tasks.length}</span>
        </div>
      </div>
      {tasks.length === 0 ? <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center typography-meta text-muted-foreground">{emptyLabel}</div> : null}
      {tasks.map((task) => <DraggableTaskCard key={task.id} task={task} project={task.projectId ? projectsById.get(task.projectId) ?? null : null} onOpen={onOpen} />)}
    </div>
  );
};

const ReadOnlyColumn: React.FC<{ title: string; tasks: Task[]; projectsById: Map<string, ProjectEntry>; onOpen: (taskId: string) => void; emptyLabel: string; }> = ({ title, tasks, projectsById, onOpen, emptyLabel }) => {
  return (
    <div className="flex min-h-56 flex-col gap-3 rounded-xl border border-border bg-[var(--surface-muted)] p-3">
      <div className="flex items-center justify-between">
        <h3 className="typography-ui-label text-foreground">{title}</h3>
        <span className="rounded-md bg-[var(--surface-elevated)] px-2 py-1 typography-micro text-muted-foreground">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center typography-meta text-muted-foreground">{emptyLabel}</div> : null}
      {tasks.map((task) => <TaskCard key={task.id} task={task} project={task.projectId ? projectsById.get(task.projectId) ?? null : null} onOpen={onOpen} />)}
    </div>
  );
};

const DraggableTaskCard: React.FC<{ task: Task; project: ProjectEntry | null; onOpen: (taskId: string) => void; }> = ({ task, project, onOpen }) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id, data: { taskId: task.id } });
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: task.id, data: { taskId: task.id, status: task.status } });
  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    setDropNodeRef(node);
  }, [setDropNodeRef, setNodeRef]);
  return (
    <div ref={setRefs} style={{ transform: CSS.Translate.toString(transform) }} className={isOver ? 'ring-2 ring-[var(--interactive-focus-ring)] rounded-lg' : undefined}>
      <TaskCard task={task} project={project} onOpen={onOpen} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
};

const buildReorderPatches = (tasks: Task[], activeTaskId: string, overId: string): Array<{ task: Task; patch: Partial<Task> }> => {
  const activeTask = tasks.find((task) => task.id === activeTaskId);
  if (!activeTask) {
    return [];
  }

  const overTask = tasks.find((task) => task.id === overId) ?? null;
  const nextStatus = TASK_STATUS_ORDER.includes(overId as TaskStatus)
    ? overId as TaskStatus
    : overTask?.status ?? activeTask.status;
  const targetColumn = tasks
    .filter((task) => task.status === nextStatus && task.id !== activeTaskId)
    .sort((left, right) => left.order - right.order || left.createdAt - right.createdAt);
  const insertIndex = overTask && overTask.id !== activeTaskId
    ? Math.max(0, targetColumn.findIndex((task) => task.id === overTask.id))
    : targetColumn.length;
  const nextColumn = targetColumn.slice();
  nextColumn.splice(insertIndex < 0 ? targetColumn.length : insertIndex, 0, activeTask);

  const sourceColumn = activeTask.status === nextStatus
    ? []
    : tasks
      .filter((task) => task.status === activeTask.status && task.id !== activeTaskId)
      .sort((left, right) => left.order - right.order || left.createdAt - right.createdAt);

  const patches: Array<{ task: Task; patch: Partial<Task> }> = [];
  nextColumn.forEach((task, index) => {
    const patch: Partial<Task> = {};
    if (task.status !== nextStatus) {
      patch.status = nextStatus;
    }
    if (task.order !== index) {
      patch.order = index;
    }
    if (Object.keys(patch).length > 0) {
      patches.push({ task, patch });
    }
  });
  sourceColumn.forEach((task, index) => {
    if (task.order !== index) {
      patches.push({ task, patch: { order: index } });
    }
  });
  return patches;
};

export const TaskManagerView: React.FC = () => {
  const { t } = useI18n();
  const projects = useProjectsStore((state) => state.projects);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const currentBranch = useGitBranchLabel(currentDirectory);
  const workspaces = useWorkspacesStore((state) => state.workspaces);
  const workspacesLoading = useWorkspacesStore((state) => state.isLoading);
  const workspacesError = useWorkspacesStore((state) => state.error);
  const loadWorkspaces = useWorkspacesStore((state) => state.loadWorkspaces);
  const createWorkspace = useWorkspacesStore((state) => state.createWorkspace);
  const applyWorkspaceEvent = useWorkspacesStore((state) => state.applyEvent);
  const activeWorkspaceId = useTaskManagerUIStore((state) => state.activeWorkspaceId);
  const viewMode = useTaskManagerUIStore((state) => state.viewMode);
  const setViewMode = useTaskManagerUIStore((state) => state.setViewMode);
  const setActiveWorkspaceId = useTaskManagerUIStore((state) => state.setActiveWorkspaceId);
  const projectFilterByWorkspace = useTaskManagerUIStore((state) => state.projectFilterByWorkspace);
  const setProjectFilter = useTaskManagerUIStore((state) => state.setProjectFilter);
  const openCreateTaskModal = useTaskManagerUIStore((state) => state.openCreateTaskModal);
  const openEditTaskModal = useTaskManagerUIStore((state) => state.openEditTaskModal);
  const loadWorkspaceTasks = useTasksStore((state) => state.loadWorkspaceTasks);
  const updateTask = useTasksStore((state) => state.updateTask);
  const applyTaskEvent = useTasksStore((state) => state.applyEvent);
  const activeTasks = useTasksForWorkspace(activeWorkspaceId);
  const tasksError = useTasksStore((state) => activeWorkspaceId ? state.errorByWorkspaceId[activeWorkspaceId] ?? null : null);
  const activeProject = React.useMemo(() => projects.find((project) => project.path === currentDirectory) ?? projects[0] ?? null, [currentDirectory, projects]);
  const projectsById = React.useMemo(() => new Map(projects.map((project) => [project.id, project] as const)), [projects]);
  const activeWorkspace = React.useMemo(() => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null, [workspaces, activeWorkspaceId]);
  const projectFilter = activeWorkspaceId ? (projectFilterByWorkspace[activeWorkspaceId] ?? null) : null;
  const selectedProjectFilter = projectFilter ? projects.find((project) => project.id === projectFilter) ?? null : null;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const [dailyDate, setDailyDate] = React.useState(() => new Date());

  React.useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  React.useEffect(() => {
    if (workspaces.length === 0) {
      return;
    }
    if (activeWorkspaceId && workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
      return;
    }
    const preferred = activeProject ? workspaces.find((workspace) => workspace.projectIDs.includes(activeProject.id)) : null;
    setActiveWorkspaceId(preferred?.id ?? workspaces[0].id);
  }, [activeProject, activeWorkspaceId, setActiveWorkspaceId, workspaces]);

  React.useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    void loadWorkspaceTasks(activeWorkspaceId);
  }, [activeWorkspaceId, loadWorkspaceTasks]);

  React.useEffect(() => {
    return subscribeOpenchamberEvents((event) => {
      if (event.type === 'scheduled-task-ran') {
        return;
      }
      if (event.type === 'workspace.created' || event.type === 'workspace.updated' || event.type === 'workspace.deleted') {
        applyWorkspaceEvent(event);
        return;
      }
      applyTaskEvent(event);
    });
  }, [applyTaskEvent, applyWorkspaceEvent]);

  const filteredTasks = React.useMemo(() => {
    if (!projectFilter) {
      return activeTasks;
    }
    return activeTasks.filter((task) => task.projectId === projectFilter);
  }, [activeTasks, projectFilter]);

  const dailySections = React.useMemo(() => deriveDailySections(filteredTasks, dailyDate), [filteredTasks, dailyDate]);
  const dailyDateInputValue = React.useMemo(() => formatDateInputValue(dailyDate), [dailyDate]);
  const isDailyToday = React.useMemo(() => formatDateInputValue(new Date()) === dailyDateInputValue, [dailyDateInputValue]);

  const openCreateModal = (status: TaskStatus = 'todo') => {
    openCreateTaskModal({
      workspaceId: activeWorkspaceId,
      projectId: activeProject?.id ?? null,
      branch: currentBranch,
      sessionId: currentSessionId,
      status,
    });
  };

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    if (!activeWorkspaceId || !event.over) {
      return;
    }
    const taskId = String(event.active.id);
    const overId = String(event.over.id);
    if (taskId === overId) {
      return;
    }
    const patches = buildReorderPatches(activeTasks, taskId, overId);
    if (patches.length > 0) {
      void Promise.all(patches.map(({ task, patch }) => updateTask(activeWorkspaceId, task.id, patch))).catch((error) => {
        toast.error(error instanceof Error ? error.message : t('tasks.error.load'));
      });
    }
  }, [activeTasks, activeWorkspaceId, t, updateTask]);

  const handleCreateWorkspace = async () => {
    const name = window.prompt(t('tasks.workspace.promptName'))?.trim();
    if (!name) {
      return;
    }
    await createWorkspace(name).catch(() => {});
  };

  const memberProjects = React.useMemo(() => {
    if (!activeWorkspace) {
      return [] as ProjectEntry[];
    }
    return projects.filter((project) => activeWorkspace.projectIDs.includes(project.id));
  }, [activeWorkspace, projects]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Select value={activeWorkspaceId ?? undefined} onValueChange={(value) => setActiveWorkspaceId(value || null)}>
          <SelectTrigger className="w-56 max-w-full"><SelectValue placeholder={t('tasks.header.workspace')}>{activeWorkspace?.name}</SelectValue></SelectTrigger>
          <SelectContent>
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={() => void handleCreateWorkspace()}>
          <Icon name="add" className="mr-1 h-4 w-4" />
          {t('tasks.workspace.new')}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant={viewMode === 'kanban' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('kanban')}>{t('tasks.header.kanban')}</Button>
          <Button type="button" variant={viewMode === 'daily' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('daily')}>{t('tasks.header.daily')}</Button>
          <Select value={projectFilter ?? EMPTY_VALUE} onValueChange={(value) => activeWorkspaceId && setProjectFilter(activeWorkspaceId, value === EMPTY_VALUE ? null : value)}>
            <SelectTrigger className="w-56 max-w-full"><SelectValue placeholder={t('tasks.header.projectFilter')}>{selectedProjectFilter?.label || selectedProjectFilter?.path || t('tasks.header.projectFilterAll')}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_VALUE}>{t('tasks.header.projectFilterAll')}</SelectItem>
              {memberProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.label || project.path}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" onClick={() => openCreateModal()}>{t('tasks.header.newTask')}</Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {workspacesLoading ? <div className="typography-ui text-muted-foreground">{t('common.loading')}</div> : null}
        {workspacesError ? (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-3 py-2 typography-ui text-[var(--status-error)]">
            <span>{workspacesError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadWorkspaces()}>{t('tasks.error.retry')}</Button>
          </div>
        ) : null}
        {!workspacesLoading && workspaces.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <div className="typography-ui-header text-foreground">{t('tasks.empty.noWorkspaces')}</div>
            <div className="mt-2 typography-ui text-muted-foreground">{t('tasks.empty.noTasks')}</div>
            <Button type="button" className="mt-4" onClick={() => void handleCreateWorkspace()}>{t('tasks.workspace.new')}</Button>
          </div>
        ) : null}
        {activeWorkspace && tasksError ? (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-3 py-2 typography-ui text-[var(--status-error)]">
            <span>{tasksError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadWorkspaceTasks(activeWorkspace.id)}>{t('tasks.error.retry')}</Button>
          </div>
        ) : null}
        {activeWorkspace ? (
          viewMode === 'kanban' ? (
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <div className="grid gap-4 lg:grid-cols-3">
                {TASK_STATUS_ORDER.map((status) => (
                  <ColumnDropZone
                    key={status}
                    id={status}
                    title={t(STATUS_LABEL_KEYS[status])}
                    tasks={getTasksForStatus(filteredTasks, status)}
                    projectsById={projectsById}
                    onOpen={openEditTaskModal}
                    onCreate={status === 'todo' ? openCreateModal : undefined}
                    createLabel={t('tasks.header.newTask')}
                    emptyLabel={t('tasks.empty.column')}
                  />
                ))}
              </div>
            </DndContext>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setDailyDate((value) => new Date(value.getFullYear(), value.getMonth(), value.getDate() - 1))}>{t('tasks.daily.previousDay')}</Button>
                <Button type="button" variant={isDailyToday ? 'default' : 'outline'} size="sm" onClick={() => setDailyDate(new Date())}>{t('tasks.daily.today')}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDailyDate((value) => new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1))}>{t('tasks.daily.nextDay')}</Button>
                <input
                  type="date"
                  value={dailyDateInputValue}
                  onChange={(event) => {
                    const nextDate = parseDateInputValue(event.target.value);
                    if (nextDate) {
                      setDailyDate(nextDate);
                    }
                  }}
                  aria-label={t('tasks.daily.datePicker')}
                  className="h-8 rounded-md border border-border bg-[var(--surface-elevated)] px-2 typography-ui-label text-foreground outline-none focus:border-[var(--interactive-focus-ring)]"
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ReadOnlyColumn title={t('tasks.daily.doing')} tasks={dailySections.doing} projectsById={projectsById} onOpen={openEditTaskModal} emptyLabel={t('tasks.empty.column')} />
                <ReadOnlyColumn title={t('tasks.daily.done')} tasks={dailySections.done} projectsById={projectsById} onOpen={openEditTaskModal} emptyLabel={t('tasks.empty.noDaily')} />
              </div>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
};
