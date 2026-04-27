'use client';

// Stint 57.D.5 — hover preview popover for the tasks list.
//
// Wraps the title cell. After ~400ms of hovering, opens a fixed-
// position panel with the task's description (truncated), counts
// of subtasks/comments/attachments, blocker status and the most
// recent comment. Click anywhere closes; mouse leaving the trigger
// (with a small grace window so you can move into the popover for
// a click) also closes.
//
// All-content fetched on first hover from the existing detail
// endpoint; cached for the lifetime of the row.

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

const HOVER_OPEN_MS = 400;
const HOVER_CLOSE_MS = 150;
const PREVIEW_DESC_CHARS = 240;

interface PreviewPayload {
  description: string | null;
  subtask_total: number;
  subtask_done: number;
  comment_count: number;
  attachment_count: number;
  last_comment: string | null;
  blocker_title: string | null;
  blocker_status: string | null;
  // Stint 58.T2.4 — sign-off names surfaced in the preview now that the
  // list cell shows only a compact lock/ready icon (no more 1/3 chip).
  preparer: string | null;
  reviewer: string | null;
  partner_sign_off: string | null;
}

const cache = new Map<string, PreviewPayload>();

async function fetchPreview(taskId: string): Promise<PreviewPayload | null> {
  if (cache.has(taskId)) return cache.get(taskId)!;
  try {
    const [detailRes, commentsRes, attachRes] = await Promise.all([
      fetch(`/api/tax-ops/tasks/${taskId}`),
      fetch(`/api/tax-ops/tasks/${taskId}/comments`),
      fetch(`/api/tax-ops/tasks/${taskId}/attachments`),
    ]);
    if (!detailRes.ok) return null;
    const detail = await detailRes.json() as {
      task: {
        description: string | null;
        preparer: string | null;
        reviewer: string | null;
        partner_sign_off: string | null;
      };
      subtasks: Array<{ status: string }>;
      blocker: { title: string; status: string } | null;
    };
    const comments = commentsRes.ok
      ? (await commentsRes.json() as { comments: Array<{ body: string }> }).comments
      : [];
    const attachments = attachRes.ok
      ? (await attachRes.json() as { attachments: unknown[] }).attachments
      : [];
    const payload: PreviewPayload = {
      description: detail.task.description,
      subtask_total: detail.subtasks.length,
      subtask_done: detail.subtasks.filter(s => s.status === 'done').length,
      comment_count: comments.length,
      attachment_count: attachments.length,
      last_comment: comments[comments.length - 1]?.body ?? null,
      blocker_title: detail.blocker?.title ?? null,
      blocker_status: detail.blocker?.status ?? null,
      preparer: detail.task.preparer,
      reviewer: detail.task.reviewer,
      partner_sign_off: detail.task.partner_sign_off,
    };
    cache.set(taskId, payload);
    return payload;
  } catch {
    return null;
  }
}

interface Props {
  taskId: string;
  children: React.ReactNode;
}

export function TaskHoverPreview({ taskId, children }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [data, setData] = useState<PreviewPayload | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  function recompute() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Anchor below the title cell, slightly indented.
    const left = Math.min(r.left, window.innerWidth - 360);
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  }

  useLayoutEffect(() => { if (open) recompute(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => recompute();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  function scheduleOpen() {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (openTimer.current) return;
    openTimer.current = window.setTimeout(async () => {
      openTimer.current = null;
      const p = await fetchPreview(taskId);
      if (p) {
        setData(p);
        setOpen(true);
      }
    }, HOVER_OPEN_MS);
  }

  function scheduleClose() {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, HOVER_CLOSE_MS);
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        className="contents"
      >
        {children}
      </span>
      {mounted && open && pos && data && createPortal(
        <div
          onMouseEnter={() => {
            if (closeTimer.current) {
              window.clearTimeout(closeTimer.current);
              closeTimer.current = null;
            }
          }}
          onMouseLeave={scheduleClose}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-popover w-[360px] bg-surface border border-border rounded-md shadow-lg p-3 text-sm"
        >
          {data.description ? (
            <div className="text-ink mb-2 whitespace-pre-wrap">
              {data.description.length > PREVIEW_DESC_CHARS
                ? data.description.slice(0, PREVIEW_DESC_CHARS) + '…'
                : data.description}
            </div>
          ) : (
            <div className="text-ink-muted italic mb-2">No description.</div>
          )}
          <div className="flex items-center gap-3 text-2xs text-ink-muted">
            <span title="Sub-tasks done / total">
              ▾ {data.subtask_done}/{data.subtask_total}
            </span>
            <span title="Comments">💬 {data.comment_count}</span>
            <span title="Attachments">📎 {data.attachment_count}</span>
          </div>
          {data.blocker_title && (
            <div
              className={`mt-2 text-2xs px-2 py-1 rounded ${
                data.blocker_status === 'done'
                  ? 'bg-success-50 text-success-800'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              {data.blocker_status === 'done' ? '🔓 Ready' : '🔒 Blocked by'}: {data.blocker_title}
            </div>
          )}

          {(() => {
            // Stint 58.T2.4 — sign-off rollup. Shown only when at least
            // one role is signed (otherwise the panel stays clean).
            const signed = [
              data.preparer && { role: 'Preparer', name: data.preparer },
              data.reviewer && { role: 'Reviewer', name: data.reviewer },
              data.partner_sign_off && { role: 'Partner', name: data.partner_sign_off },
            ].filter((x): x is { role: string; name: string } => !!x);
            if (signed.length === 0) return null;
            return (
              <div className="mt-2 pt-2 border-t border-border text-2xs">
                <div className="text-ink-muted mb-0.5">
                  Sign-off ({signed.length}/3)
                </div>
                <div className="space-y-0.5">
                  {signed.map(s => (
                    <div key={s.role} className="flex items-center gap-1">
                      <span className="text-success-700">✓</span>
                      <span className="text-ink-muted">{s.role}:</span>
                      <span className="text-ink">{s.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {data.last_comment && (
            <div className="mt-2 pt-2 border-t border-border text-2xs text-ink-muted">
              <span className="font-medium text-ink">Last comment:</span>{' '}
              {data.last_comment.length > 120
                ? data.last_comment.slice(0, 120) + '…'
                : data.last_comment}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
