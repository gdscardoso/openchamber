import React from 'react';
import type { ProjectEntry } from '@/lib/api/types';
import type { Task, TaskStatus } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

type TaskCardProps = {
  task: Task;
  project: ProjectEntry | null;
  onOpen: (taskId: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
};

const STATUS_LABEL_KEYS: Record<TaskStatus, 'tasks.status.todo' | 'tasks.status.in_progress' | 'tasks.status.done'> = {
  todo: 'tasks.status.todo',
  in_progress: 'tasks.status.in_progress',
  done: 'tasks.status.done',
};

const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  todo: 'border border-[var(--interactive-border)] bg-[var(--surface-muted)] text-muted-foreground',
  in_progress: 'border border-[var(--status-info-border)] bg-[var(--status-info-background)] text-[var(--status-info)]',
  done: 'border border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]',
};

const TaskCardComponent: React.FC<TaskCardProps> = ({ task, project, onOpen, dragHandleProps }) => {
  const { t } = useI18n();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(task.id);
        }
      }}
      className="cursor-pointer touch-none select-none rounded-lg border border-border bg-[var(--surface-elevated)] p-3 shadow-sm transition-colors hover:border-[var(--interactive-border)]"
      {...dragHandleProps}
    >
      <div className="truncate typography-ui-label text-foreground">{task.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={cn('rounded-md px-2 py-1 typography-micro', STATUS_BADGE_CLASS[task.status])}>
          {t(STATUS_LABEL_KEYS[task.status])}
        </span>
        {project ? (
          <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 typography-micro text-muted-foreground">{project.label || project.path}</span>
        ) : null}
        {task.branch ? (
          <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 typography-micro text-muted-foreground">{task.branch}</span>
        ) : null}
        {task.tags.map((tag) => (
          <span key={tag} className="rounded-md bg-[var(--interactive-hover)] px-2 py-1 typography-micro text-foreground">#{tag}</span>
        ))}
      </div>
    </div>
  );
};

export const TaskCard = React.memo(TaskCardComponent, (prev, next) => {
  return prev.task.id === next.task.id
    && prev.task.status === next.task.status
    && prev.task.order === next.task.order
    && prev.task.title === next.task.title
    && prev.task.branch === next.task.branch
    && prev.task.projectId === next.task.projectId
    && prev.task.updatedAt === next.task.updatedAt
    && prev.task.tags.join('|') === next.task.tags.join('|')
    && prev.project?.id === next.project?.id;
});
