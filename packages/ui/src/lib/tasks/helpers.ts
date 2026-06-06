import type { Task, TaskStatus } from './types';

export const TASK_STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done'];

const TASK_STATUS_RANK: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  done: 2,
};

export const sortTasks = (tasks: Task[]): Task[] => {
  return tasks.slice().sort((left, right) => {
    const statusDelta = TASK_STATUS_RANK[left.status] - TASK_STATUS_RANK[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.createdAt - right.createdAt;
  });
};

export const getTasksForStatus = (tasks: Task[], status: TaskStatus): Task[] => {
  return sortTasks(tasks.filter((task) => task.status === status));
};

export const getNextTaskOrder = (tasks: Task[], status: TaskStatus): number => {
  let maxOrder = -1;
  for (const task of tasks) {
    if (task.status === status) {
      maxOrder = Math.max(maxOrder, task.order);
    }
  }
  return maxOrder + 1;
};

export const withOptimisticStatusTimestamps = (task: Task, patch: Partial<Task>, now: number = Date.now()): Partial<Task> => {
  if (patch.status == null || patch.status === task.status) {
    return patch;
  }
  const next: Partial<Task> = { ...patch };
  if (patch.status === 'in_progress' && task.startedAt == null) {
    next.startedAt = now;
  }
  if (patch.status === 'done') {
    next.completedAt = now;
  } else if (task.status === 'done') {
    next.completedAt = null;
  }
  if (patch.status === 'todo') {
    next.startedAt = null;
    next.completedAt = null;
  }
  return next;
};

export const isSameDay = (left: Date, right: Date): boolean => {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
};

const startOfDay = (date: Date): number => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
};

const endOfDay = (date: Date): number => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next.getTime();
};

export const deriveDailySections = (tasks: Task[], date: Date): { doing: Task[]; done: Task[] } => {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const doing: Task[] = [];
  const done: Task[] = [];
  for (const task of tasks) {
    if (task.startedAt != null && task.startedAt <= dayEnd && (task.completedAt == null || task.completedAt > dayEnd)) {
      doing.push(task);
      continue;
    }
    if (task.completedAt != null && task.completedAt >= dayStart && task.completedAt <= dayEnd) {
      done.push(task);
    }
  }
  return {
    doing: sortTasks(doing),
    done: sortTasks(done),
  };
};

export const formatTaskTagsInput = (tags: string[]): string => tags.join(', ');

export const parseTaskTagsInput = (value: string): string[] => {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};
