import React from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import { SimpleMarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { CodeMirrorEditor } from '@/components/ui/CodeMirrorEditor';
import { createFlexokiCodeMirrorTheme } from '@/lib/codemirror/flexokiTheme';
import { languageByExtension } from '@/lib/codemirror/languageByExtension';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { EditorView, keymap as cmKeymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { parseTaskTagsInput, formatTaskTagsInput } from '@/lib/tasks/helpers';
import type { ProjectEntry } from '@/lib/api/types';
import type { Task, TaskInput, TaskStatus } from '@/lib/tasks/types';
import { useTaskManagerUIStore } from '@/stores/useTaskManagerUIStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useTasksStore } from '@/stores/useTasksStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useGitBranchLabel } from '@/stores/useGitStore';
import { toast } from '@/components/ui';
import { checkoutBranch, getGitBranches } from '@/lib/gitApi';

type TaskFormState = {
  workspaceId: string;
  title: string;
  content: string;
  tags: string;
  projectId: string;
  branch: string;
  sessionId: string;
  status: TaskStatus;
};

const EMPTY_VALUE = '__none';

const buildFormState = (
  task: Task | null,
  workspaceId: string,
  draft: { projectId?: string | null; branch?: string | null; sessionId?: string | null; status?: TaskStatus } | null,
  branchPrefill: string | null,
  sessionIdPrefill: string | null,
): TaskFormState => ({
  workspaceId,
  title: task?.title ?? '',
  content: task?.content ?? '',
  tags: formatTaskTagsInput(task?.tags ?? []),
  projectId: task?.projectId ?? draft?.projectId ?? '',
  branch: task?.branch ?? draft?.branch ?? branchPrefill ?? '',
  sessionId: task?.sessionId ?? draft?.sessionId ?? sessionIdPrefill ?? '',
  status: task?.status ?? draft?.status ?? 'todo',
});

export const TaskModalRoot: React.FC = () => {
  const { t } = useI18n();
  const isOpen = useTaskManagerUIStore((state) => state.isTaskModalOpen);
  const editingTaskId = useTaskManagerUIStore((state) => state.editingTaskId);
  const taskModalDraft = useTaskManagerUIStore((state) => state.taskModalDraft);
  const closeTaskModal = useTaskManagerUIStore((state) => state.closeTaskModal);
  const activeWorkspaceId = useTaskManagerUIStore((state) => state.activeWorkspaceId);
  const setActiveWorkspaceId = useTaskManagerUIStore((state) => state.setActiveWorkspaceId);
  const workspaces = useWorkspacesStore((state) => state.workspaces);
  const loadWorkspaces = useWorkspacesStore((state) => state.loadWorkspaces);
  const tasksByWorkspaceId = useTasksStore((state) => state.tasksByWorkspaceId);
  const createTask = useTasksStore((state) => state.createTask);
  const updateTask = useTasksStore((state) => state.updateTask);
  const deleteTask = useTasksStore((state) => state.deleteTask);
  const projects = useProjectsStore((state) => state.projects);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const currentBranch = useGitBranchLabel(currentDirectory);
  const { currentTheme } = useThemeSystem();
  const submitRef = React.useRef<() => void>(() => {});

  const editorExtensions = React.useMemo(() => {
    const extensions = [
      Prec.highest(cmKeymap.of([{ key: 'Mod-Enter', run: () => { submitRef.current(); return true; } }])),
      createFlexokiCodeMirrorTheme(currentTheme),
      EditorView.lineWrapping,
      cmPlaceholder(t('tasks.modal.contentPlaceholder')),
    ];
    const language = languageByExtension('task.md');
    if (language) {
      extensions.push(language);
    }
    return extensions;
  }, [currentTheme, t]);

  React.useEffect(() => {
    if (isOpen && workspaces.length === 0) {
      void loadWorkspaces();
    }
  }, [isOpen, workspaces.length, loadWorkspaces]);

  const editingWorkspace = React.useMemo(() => {
    if (!editingTaskId) {
      return null;
    }
    for (const workspace of workspaces) {
      const task = (tasksByWorkspaceId[workspace.id] ?? []).find((entry) => entry.id === editingTaskId);
      if (task) {
        return workspace;
      }
    }
    return null;
  }, [editingTaskId, tasksByWorkspaceId, workspaces]);

  const editingTask = React.useMemo(() => {
    if (!editingTaskId || !editingWorkspace) {
      return null;
    }
    return (tasksByWorkspaceId[editingWorkspace.id] ?? []).find((entry) => entry.id === editingTaskId) ?? null;
  }, [editingTaskId, editingWorkspace, tasksByWorkspaceId]);

  const defaultWorkspaceId = editingWorkspace?.id ?? taskModalDraft?.workspaceId ?? activeWorkspaceId ?? workspaces[0]?.id ?? '';
  const [form, setForm] = React.useState<TaskFormState>(() => buildFormState(editingTask, defaultWorkspaceId, taskModalDraft, currentBranch, currentSessionId));
  const [isPreview, setIsPreview] = React.useState(() => Boolean(editingTask));
  const [isSaving, setIsSaving] = React.useState(false);
  const [createMore, setCreateMore] = React.useState(false);
  const [branchOptions, setBranchOptions] = React.useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = React.useState(false);
  const [isCheckingOutBranch, setIsCheckingOutBranch] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    setForm(buildFormState(editingTask, defaultWorkspaceId, taskModalDraft, currentBranch, currentSessionId));
    setIsPreview(Boolean(editingTask));
  }, [isOpen, editingTask, defaultWorkspaceId, taskModalDraft, currentBranch, currentSessionId]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === form.workspaceId) ?? null;
  const workspaceProjects = React.useMemo(() => {
    if (!selectedWorkspace) {
      return [] as ProjectEntry[];
    }
    return projects.filter((project) => selectedWorkspace.projectIDs.includes(project.id));
  }, [projects, selectedWorkspace]);
  const selectedProject = form.projectId ? workspaceProjects.find((project) => project.id === form.projectId) ?? null : null;
  const branchListId = selectedProject ? `task-branch-options-${selectedProject.id}` : 'task-branch-options';

  React.useEffect(() => {
    if (!isOpen || !selectedProject) {
      setBranchOptions([]);
      return;
    }
    let cancelled = false;
    setIsLoadingBranches(true);
    void getGitBranches(selectedProject.path)
      .then((branches) => {
        if (!cancelled) {
          setBranchOptions(Array.from(new Set(branches.all)).sort((left, right) => left.localeCompare(right)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranchOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingBranches(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedProject]);

  const handleSave = async () => {
    const workspaceId = editingWorkspace?.id ?? form.workspaceId;
    if (!workspaceId) {
      return;
    }
    const payload: TaskInput = {
      title: form.title,
      content: form.content,
      tags: parseTaskTagsInput(form.tags),
      projectId: form.projectId || null,
      branch: form.branch || null,
      sessionId: form.sessionId || null,
      status: form.status,
    };
    setIsSaving(true);
    try {
      if (editingTask) {
        await updateTask(workspaceId, editingTask.id, payload);
      } else {
        await createTask(workspaceId, payload);
        setActiveWorkspaceId(workspaceId);
        if (createMore) {
          setForm((state) => ({ ...state, title: '', content: '', tags: '' }));
          setIsPreview(false);
          return;
        }
      }
      closeTaskModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('tasks.error.load'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleModalKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!isSaving && form.title.trim()) {
        void handleSave();
      }
    }
  };

  submitRef.current = () => {
    if (!isSaving && form.title.trim()) {
      void handleSave();
    }
  };

  const handleDelete = async () => {
    if (!editingTask || !editingWorkspace) {
      return;
    }
    if (!window.confirm(t('tasks.modal.deleteConfirm'))) {
      return;
    }
    setIsSaving(true);
    try {
      await deleteTask(editingWorkspace.id, editingTask.id);
      closeTaskModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('tasks.error.load'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckoutBranch = async () => {
    if (!selectedProject || !form.branch.trim()) {
      return;
    }
    setIsCheckingOutBranch(true);
    try {
      const result = await checkoutBranch(selectedProject.path, form.branch.trim());
      toast.success(t('tasks.modal.toast.checkoutSuccess', { branch: result.branch }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('tasks.modal.toast.checkoutFailed'));
    } finally {
      setIsCheckingOutBranch(false);
    }
  };

  const handleOpenSession = () => {
    const sessionId = form.sessionId.trim();
    if (!sessionId) {
      return;
    }
    setCurrentSession(sessionId, selectedProject?.path ?? null);
    setActiveMainTab('chat');
    closeTaskModal();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeTaskModal(); }}>
      <DialogContent className="max-w-3xl" onKeyDown={handleModalKeyDown}>
        <DialogHeader>
          <DialogTitle>{editingTask ? t('tasks.modal.editTitle') : t('tasks.modal.createTitle')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[78vh] space-y-4 overflow-y-auto py-1 pr-1">
          <div className="space-y-1.5">
            <label className="typography-ui-label text-foreground">{t('tasks.modal.field.title')}</label>
            <Input value={form.title} onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))} autoFocus placeholder={t('tasks.modal.field.title')} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="typography-ui-label text-foreground">{t('tasks.modal.field.content')}</label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsPreview((value) => !value)}>
                {t('tasks.modal.field.preview')}
              </Button>
            </div>
            {isPreview ? (
              <div className="h-[42vh] min-h-[260px] overflow-auto rounded-md border border-border bg-[var(--surface-elevated)] p-3">
                <SimpleMarkdownRenderer content={form.content} className="typography-markdown-body" />
              </div>
            ) : (
              <div className="h-[42vh] min-h-[260px] overflow-hidden rounded-md border border-border bg-[var(--surface-elevated)]">
                <CodeMirrorEditor
                  value={form.content}
                  onChange={(value) => setForm((state) => ({ ...state, content: value }))}
                  extensions={editorExtensions}
                  className="h-full"
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {!editingTask ? (
              <div className="space-y-1.5">
                <label className="typography-ui-label text-foreground">{t('tasks.header.workspace')}</label>
                <Select value={form.workspaceId || EMPTY_VALUE} onValueChange={(value) => setForm((state) => ({ ...state, workspaceId: value === EMPTY_VALUE ? '' : value, projectId: '' }))}>
                  <SelectTrigger><SelectValue placeholder={t('tasks.header.workspace')}>{selectedWorkspace?.name}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label className="typography-ui-label text-foreground">{t('tasks.modal.field.project')}</label>
              <Select value={form.projectId || EMPTY_VALUE} onValueChange={(value) => setForm((state) => ({ ...state, projectId: value === EMPTY_VALUE ? '' : value }))}>
                <SelectTrigger><SelectValue placeholder={t('tasks.modal.field.project')}>{selectedProject?.label || selectedProject?.path || t('tasks.header.projectFilterAll')}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_VALUE}>{t('tasks.header.projectFilterAll')}</SelectItem>
                  {workspaceProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.label || project.path}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="typography-ui-label text-foreground">{t('tasks.modal.field.status')}</label>
              <Select value={form.status} onValueChange={(value) => setForm((state) => ({ ...state, status: value as TaskStatus }))}>
                <SelectTrigger><SelectValue>{t(form.status === 'todo' ? 'tasks.status.todo' : form.status === 'in_progress' ? 'tasks.status.in_progress' : 'tasks.status.done')}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">{t('tasks.status.todo')}</SelectItem>
                  <SelectItem value="in_progress">{t('tasks.status.in_progress')}</SelectItem>
                  <SelectItem value="done">{t('tasks.status.done')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="typography-ui-label text-foreground">{t('tasks.modal.field.branch')}</label>
              <div className="flex gap-2">
                <Input
                  value={form.branch}
                  onChange={(event) => setForm((state) => ({ ...state, branch: event.target.value }))}
                  list={selectedProject ? branchListId : undefined}
                  placeholder={isLoadingBranches ? t('tasks.modal.branch.loading') : selectedProject ? undefined : t('tasks.modal.branch.noProject')}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleCheckoutBranch()}
                  disabled={!selectedProject || !form.branch.trim() || isCheckingOutBranch}
                >
                  {t('tasks.modal.action.checkoutBranch')}
                </Button>
              </div>
              {selectedProject ? (
                <datalist id={branchListId}>
                  {branchOptions.map((branch) => <option key={branch} value={branch} />)}
                </datalist>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label className="typography-ui-label text-foreground">{t('tasks.modal.field.session')}</label>
              <div className="flex gap-2">
                <Input value={form.sessionId} onChange={(event) => setForm((state) => ({ ...state, sessionId: event.target.value }))} />
                <Button type="button" variant="outline" onClick={handleOpenSession} disabled={!form.sessionId.trim()}>
                  {t('tasks.modal.action.openSession')}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="typography-ui-label text-foreground">{t('tasks.modal.field.tags')}</label>
              <Input value={form.tags} onChange={(event) => setForm((state) => ({ ...state, tags: event.target.value }))} placeholder={t('tasks.modal.field.tagsPlaceholder')} />
            </div>
          </div>
          {editingTask ? (
            <ol className="relative ml-1 space-y-3 border-l border-[var(--interactive-border)] pl-4">
              <li className="relative">
                <span className="absolute -left-[1.30rem] top-1 h-2 w-2 rounded-full bg-[var(--surface-muted-foreground)]" />
                <span className="typography-meta text-muted-foreground">{t('tasks.modal.timestamp.created', { date: new Date(editingTask.createdAt).toLocaleString() })}</span>
              </li>
              {editingTask.startedAt ? (
                <li className="relative">
                  <span className="absolute -left-[1.30rem] top-1 h-2 w-2 rounded-full bg-[var(--status-info)]" />
                  <span className="typography-meta text-muted-foreground">{t('tasks.modal.timestamp.started', { date: new Date(editingTask.startedAt).toLocaleString() })}</span>
                </li>
              ) : null}
              {editingTask.completedAt ? (
                <li className="relative">
                  <span className="absolute -left-[1.30rem] top-1 h-2 w-2 rounded-full bg-[var(--status-success)]" />
                  <span className="typography-meta text-muted-foreground">{t('tasks.modal.timestamp.completed', { date: new Date(editingTask.completedAt).toLocaleString() })}</span>
                </li>
              ) : null}
            </ol>
          ) : null}
        </div>
        <DialogFooter className="justify-between">
          <div>
            {editingTask ? (
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={isSaving}>{t('tasks.modal.action.delete')}</Button>
            ) : (
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={createMore} onChange={setCreateMore} ariaLabel={t('tasks.modal.createMore')} disabled={isSaving} />
                <span className="typography-ui-label text-foreground">{t('tasks.modal.createMore')}</span>
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => closeTaskModal()} disabled={isSaving}>{t('tasks.modal.action.cancel')}</Button>
            <Button type="button" onClick={() => void handleSave()} disabled={isSaving || !form.title.trim()}>
              {editingTask ? t('tasks.modal.action.save') : t('tasks.modal.action.create')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
