import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, type Staff, type Task, type TaskPriority } from '../api';
import { useMe } from '../auth';
import { Dialog } from '../components/Dialog';
import { Badge, EmptyState, ErrorState, FormError, PageHeader, Skeleton, Spinner } from '../components/ui';
import { formatDay, todayKey } from '../lib/format';
import { taskPriority, taskSource } from '../lib/labels';

function TaskItem({ task }: { task: Task }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (done: boolean) => api.patch<Task>(`/tasks/${task.id}`, { status: done ? 'done' : 'open' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const done = m.isPending ? m.variables : task.status === 'done';
  const p = taskPriority[task.priority];
  const id = `task-${task.id}`;
  return (
    <li className={`task ${done ? 'task--done' : ''}`}>
      <input id={id} type="checkbox" checked={!!done} disabled={m.isPending} onChange={(e) => m.mutate(e.target.checked)} />
      <div className="task__main">
        <label htmlFor={id} className="task__title">
          {task.title}
        </label>
        <p className="task__meta">
          {task.assignee && <span>{task.assignee.name}</span>}
          {task.dueDate && <span>fällig {formatDay(task.dueDate)}</span>}
          {task.source !== 'manual' && <Badge tone="blue">{taskSource[task.source]}</Badge>}
          <Badge tone={p?.tone}>{p?.label ?? task.priority}</Badge>
        </p>
        {m.isError && <FormError error={m.error} />}
      </div>
    </li>
  );
}

function Group({ title, tasks, tone }: { title: string; tasks: Task[]; tone?: string }) {
  if (tasks.length === 0) return null;
  return (
    <section className={`card card--pad task-group ${tone ? `task-group--${tone}` : ''}`} aria-labelledby={`tg-${title}`}>
      <h2 id={`tg-${title}`} className="card-title">
        {title} <span className="count">{tasks.length}</span>
      </h2>
      <ul className="task-list">
        {tasks.map((t) => (
          <TaskItem key={t.id} task={t} />
        ))}
      </ul>
    </section>
  );
}

function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<Staff[]>('/staff'), enabled: open });
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const m = useMutation({
    mutationFn: () =>
      api.post<Task>('/tasks', {
        title: title.trim(),
        assigneeId: assigneeId || undefined,
        dueDate: dueDate || undefined,
        priority,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setTitle('');
      setAssigneeId('');
      setDueDate('');
      setPriority('normal');
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) m.mutate();
  }
  return (
    <Dialog open={open} onClose={onClose} title="Neue Aufgabe">
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="nt-title">Aufgabe *</label>
          <input id="nt-title" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="nt-assignee">Zuständig</label>
            <select id="nt-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Nicht zugewiesen</option>
              {staff.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nt-due">Fällig am</label>
            <input id="nt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nt-prio">Priorität</label>
            <select id="nt-prio" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {Object.entries(taskPriority).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <FormError error={staff.error || m.error} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary" disabled={m.isPending || !title.trim()}>
            {m.isPending && <Spinner />} Aufgabe anlegen
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const prioRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function TasksPage() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['tasks'], queryFn: () => api.get<Task[]>('/tasks') });
  const today = todayKey();
  const sortOpen = (a: Task, b: Task) =>
    (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || prioRank[a.priority] - prioRank[b.priority];
  const openTasks = (q.data ?? []).filter((t) => t.status === 'open');
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today).sort(sortOpen);
  const pending = openTasks.filter((t) => !t.dueDate || t.dueDate.slice(0, 10) >= today).sort(sortOpen);
  const done = (q.data ?? []).filter((t) => t.status === 'done');

  return (
    <div className="stack-lg">
      <PageHeader
        title="Aufgaben"
        subtitle={`Automatisch von ${me.ai.name || 'der KI'} oder manuell erstellt.`}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" /> Neue Aufgabe
          </button>
        }
      />
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={6} />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && (
        <div className="card">
          <EmptyState title="Keine Aufgaben" text="Alles erledigt." />
        </div>
      )}
      <Group title="Überfällig" tasks={overdue} tone="red" />
      <Group title="Offen" tasks={pending} />
      <Group title="Erledigt" tasks={done} tone="done" />
      <NewTaskDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
