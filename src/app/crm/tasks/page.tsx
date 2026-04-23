'use client';

import { useEffect, useState, useCallback } from 'react';
import { PlusIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { ExportButton } from '@/components/crm/ExportButton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { crmLoadList } from '@/lib/useCrmFetch';
import { TASK_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
import {
  LABELS_TASK_STATUS, LABELS_TASK_PRIORITY, TASK_STATUSES, TASK_PRIORITIES,
  formatDate, type TaskStatus, type TaskPriority,
} from '@/lib/crm-types';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  reminder_at: string | null;
  related_type: string | null;
  related_id: string | null;
  auto_generated: boolean;
  completed_at: string | null;
  created_at: string;
}

export default function TasksPage() {
  const [rows, setRows] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [priority, setPriority] = useState<string>('');
  const [newOpen, setNewOpen] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (priority) qs.set('priority', priority);
    crmLoadList<Task>(`/api/crm/tasks?${qs}`)
      .then(rows => { setRows(rows); setError(null); })
      .catch((e: Error) => { setError(e.message || 'Network error'); setRows([]); });
  }, [status, priority]);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(values: Record<string, unknown>) {
    const res = await fetch('/api/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Task created');
    await load();
  }

  async function toggleDone(id: string, current: string) {
    const nextStatus = current === 'done' ? 'open' : 'done';
    const res = await fetch(`/api/crm/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) load();
  }

  if (rows === null) return <PageSkeleton />;

  const overdue = rows.filter(r => r.due_date && new Date(r.due_date) < new Date() && r.status !== 'done' && r.status !== 'cancelled').length;
  const dueToday = rows.filter(r => r.due_date === new Date().toISOString().slice(0, 10)).length;

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${rows.length} open${overdue ? ` · ${overdue} overdue` : ''}${dueToday ? ` · ${dueToday} due today` : ''}`}
        actions={
          <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
            New task
          </Button>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="New task"
        subtitle="Follow-up, reminder, or work item."
        fields={TASK_FIELDS}
        initial={{ priority: 'medium', status: 'open' }}
        onSave={handleCreate}
      />
      {error && <div className="mb-3"><CrmErrorBox message={error} onRetry={load} /></div>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-white">
          <option value="">Open + In progress + Snoozed</option>
          {TASK_STATUSES.map(s => <option key={s} value={s}>{LABELS_TASK_STATUS[s]}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-white">
          <option value="">All priorities</option>
          {TASK_PRIORITIES.map(p => <option key={p} value={p}>{LABELS_TASK_PRIORITY[p]}</option>)}
        </select>
        <div className="ml-auto">
          <ExportButton entity="tasks" />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState illustration="inbox" title="No tasks" description="Create a task to track a follow-up, or let cifra auto-generate them when a Key Account has a stale declaration." />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-8"></th>
                <th className="text-left px-3 py-2 font-medium">Priority</th>
                <th className="text-left px-3 py-2 font-medium">Title</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Due</th>
                <th className="text-left px-3 py-2 font-medium">Related</th>
                <th className="text-left px-3 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isOverdue = r.due_date && new Date(r.due_date) < new Date() && r.status !== 'done' && r.status !== 'cancelled';
                const isDone = r.status === 'done';
                return (
                  <tr key={r.id} className={`border-t border-border hover:bg-surface-alt/50 ${isDone ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={() => toggleDone(r.id, r.status)}
                        className="h-4 w-4 accent-brand-500 cursor-pointer"
                        title={isDone ? 'Mark as open' : 'Mark as done'}
                      />
                    </td>
                    <td className="px-3 py-2">{LABELS_TASK_PRIORITY[r.priority as TaskPriority] ?? r.priority}</td>
                    <td className={`px-3 py-2 font-medium ${isDone ? 'line-through' : ''}`}>{r.title}</td>
                    <td className="px-3 py-2">{LABELS_TASK_STATUS[r.status as TaskStatus] ?? r.status}</td>
                    <td className={`px-3 py-2 tabular-nums ${isOverdue ? 'text-danger-700 font-medium' : 'text-ink-muted'}`}>{formatDate(r.due_date)}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.related_type ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.auto_generated ? 'cifra auto' : 'manual'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
