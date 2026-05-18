'use client';

// Stint 57.D.7 — right-click context menu for the tasks list.
//
// Renders a small floating menu at the cursor coordinates with quick
// actions: Mark done · Set priority · Reassign · Delete.
// Single instance lifted to the page level (not per-row); the row's
// onContextMenu hands us the task + the mouse coords. Click outside
// closes; Escape closes; clicking an action closes after dispatching.
//
// Stint 103 — Star/Unstar action removed (is_starred column dropped).

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, Trash2Icon, UserIcon } from 'lucide-react';

export interface ContextTask {
  id: string;
  title: string;
  status: string;
}

interface Props {
  task: ContextTask;
  x: number;
  y: number;
  onClose: () => void;
  onMarkDone: (id: string) => void | Promise<void>;
  onSetPriority: (id: string, priority: string) => void | Promise<void>;
  onReassign: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

export function TaskContextMenu(props: Props) {
  const { task, x, y, onClose } = props;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    function handleClick() { onClose(); }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  // Clamp inside viewport.
  const top = Math.min(y, typeof window !== 'undefined' ? window.innerHeight - 240 : y);
  const left = Math.min(x, typeof window !== 'undefined' ? window.innerWidth - 220 : x);

  return createPortal(
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top, left }}
      className="z-popover w-[200px] bg-surface border border-border rounded-md shadow-lg py-1 text-sm"
    >
      <div className="px-3 py-1 text-2xs text-ink-muted truncate" title={task.title}>
        {task.title}
      </div>
      <div className="border-t border-border my-0.5" />
      <button
        type="button"
        onClick={() => { void props.onMarkDone(task.id); onClose(); }}
        disabled={task.status === 'done'}
        className="w-full text-left px-3 py-1 hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
      >
        <CheckIcon size={11} /> Mark done
      </button>
      <div className="border-t border-border my-0.5" />
      <div className="px-3 py-0.5 text-2xs text-ink-muted">Set priority</div>
      {(['urgent', 'high', 'medium', 'low'] as const).map(p => (
        <button
          key={p}
          type="button"
          onClick={() => { void props.onSetPriority(task.id, p); onClose(); }}
          className="w-full text-left px-3 py-0.5 hover:bg-surface-alt capitalize"
        >
          {p}
        </button>
      ))}
      <div className="border-t border-border my-0.5" />
      <button
        type="button"
        onClick={() => { void props.onReassign(task.id); onClose(); }}
        className="w-full text-left px-3 py-1 hover:bg-surface-alt inline-flex items-center gap-2"
      >
        <UserIcon size={11} /> Reassign…
      </button>
      <button
        type="button"
        onClick={() => { void props.onDelete(task.id); onClose(); }}
        className="w-full text-left px-3 py-1 hover:bg-danger-50 text-danger-700 inline-flex items-center gap-2"
      >
        <Trash2Icon size={11} /> Delete
      </button>
    </div>,
    document.body,
  );
}
