import React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';

export const WorkspacesSection: React.FC = () => {
  const { t } = useI18n();
  const projects = useProjectsStore((state) => state.projects);
  const workspaces = useWorkspacesStore((state) => state.workspaces);
  const isLoading = useWorkspacesStore((state) => state.isLoading);
  const loadWorkspaces = useWorkspacesStore((state) => state.loadWorkspaces);
  const createWorkspace = useWorkspacesStore((state) => state.createWorkspace);
  const updateWorkspace = useWorkspacesStore((state) => state.updateWorkspace);
  const deleteWorkspace = useWorkspacesStore((state) => state.deleteWorkspace);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  React.useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const selectedWorkspace = React.useMemo(() => {
    if (!selectedWorkspaceId) {
      return workspaces[0] ?? null;
    }
    return workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0] ?? null;
  }, [selectedWorkspaceId, workspaces]);

  React.useEffect(() => {
    if (!selectedWorkspace) {
      setSelectedWorkspaceId(null);
      setName('');
      return;
    }
    setSelectedWorkspaceId(selectedWorkspace.id);
    setName(selectedWorkspace.name);
  }, [selectedWorkspace]);

  const handleCreateWorkspace = React.useCallback(async () => {
    const workspaceName = window.prompt(t('tasks.workspace.promptName'), t('settings.workspaces.newPlaceholder'))?.trim();
    if (!workspaceName) {
      return;
    }

    try {
      const workspace = await createWorkspace(workspaceName);
      setSelectedWorkspaceId(workspace.id);
      toast.success(t('settings.workspaces.toast.created'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.workspaces.toast.createFailed'));
    }
  }, [createWorkspace, t]);

  const handleSave = React.useCallback(async () => {
    if (!selectedWorkspace) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    setIsSaving(true);
    try {
      await updateWorkspace(selectedWorkspace.id, { name: trimmedName });
      toast.success(t('settings.workspaces.toast.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.workspaces.toast.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [name, selectedWorkspace, t, updateWorkspace]);

  const handleDelete = React.useCallback(async () => {
    if (!selectedWorkspace) {
      return;
    }
    if (!window.confirm(t('settings.workspaces.deleteConfirm', { name: selectedWorkspace.name }))) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteWorkspace(selectedWorkspace.id);
      setSelectedWorkspaceId(null);
      toast.success(t('settings.workspaces.toast.deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.workspaces.toast.deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteWorkspace, selectedWorkspace, t]);

  const handleProjectToggle = React.useCallback((projectId: string, checked: boolean) => {
    if (!selectedWorkspace) {
      return;
    }
    const nextProjectIDs = checked
      ? Array.from(new Set(selectedWorkspace.projectIDs.concat(projectId)))
      : selectedWorkspace.projectIDs.filter((id) => id !== projectId);

    void updateWorkspace(selectedWorkspace.id, { projectIDs: nextProjectIDs }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t('settings.workspaces.toast.saveFailed'));
    });
  }, [selectedWorkspace, t, updateWorkspace]);

  const hasNameChanges = Boolean(selectedWorkspace) && name.trim() !== selectedWorkspace.name;

  return (
    <ScrollableOverlay outerClassName="h-full" className="w-full bg-background">
      <div className="mx-auto w-full max-w-4xl p-3 sm:p-6 sm:pt-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="typography-ui-header truncate font-semibold text-foreground">
              {t('settings.page.workspaces.title')}
            </h2>
            <p className="typography-meta text-muted-foreground">
              {t('settings.workspaces.description')}
            </p>
          </div>
          <Button size="sm" onClick={() => void handleCreateWorkspace()}>
            {t('settings.workspaces.newPlaceholder')}
          </Button>
        </div>

        <div className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="space-y-1">
            {isLoading && workspaces.length === 0 ? (
              <p className="typography-meta px-1 text-muted-foreground">{t('tasks.modal.branch.loading')}</p>
            ) : null}
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => setSelectedWorkspaceId(workspace.id)}
                className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left typography-ui-label text-foreground hover:bg-[var(--interactive-hover)] data-[active=true]:bg-[var(--interactive-selection)]"
                data-active={workspace.id === selectedWorkspace?.id}
              >
                <span className="truncate">{workspace.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{workspace.projectIDs.length}</span>
              </button>
            ))}
          </div>

          <section className="min-w-0 space-y-5 px-2 pb-2 pt-0">
            {!selectedWorkspace ? (
              <p className="typography-meta text-muted-foreground">{t('settings.workspaces.empty')}</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <span className="typography-ui-label text-foreground">{t('tasks.modal.field.title')}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t('settings.workspaces.newPlaceholder')}
                      className="h-7 min-w-0 sm:max-w-[19rem]"
                    />
                    <Button
                      size="xs"
                      onClick={() => void handleSave()}
                      disabled={!hasNameChanges || !name.trim() || isSaving}
                    >
                      {t('settings.workspaces.action.save')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => void handleDelete()}
                      disabled={isDeleting}
                    >
                      {t('settings.workspaces.action.delete')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="typography-ui-header font-medium text-foreground">
                    {t('settings.workspaces.projects.title')}
                  </h3>
                  {projects.length === 0 ? (
                    <p className="typography-meta text-muted-foreground">{t('settings.workspaces.projects.empty')}</p>
                  ) : (
                    <div className="space-y-1">
                      {projects.map((project) => {
                        const label = project.label || project.path;
                        const checked = selectedWorkspace.projectIDs.includes(project.id);
                        return (
                          <label
                            key={project.id}
                            className="flex cursor-pointer items-center gap-2 py-1.5"
                          >
                            <Checkbox
                              checked={checked}
                              onChange={(nextChecked) => handleProjectToggle(project.id, nextChecked)}
                              ariaLabel={label}
                            />
                            <span className="min-w-0 flex-1 truncate typography-ui-label text-foreground">
                              {label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </ScrollableOverlay>
  );
};
