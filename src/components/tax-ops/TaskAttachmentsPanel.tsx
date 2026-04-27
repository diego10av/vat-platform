'use client';

// Stint 56.C — attachments panel on the task detail page.
//
// Drop-zone + listing. Drag a file (or click Browse) → POST as
// FormData to /api/tax-ops/tasks/[id]/attachments. The list endpoint
// returns rows + signed download URLs (1h TTL) so each filename is a
// direct anchor without extra round-trips.

import { useEffect, useState, useRef } from 'react';
import { PaperclipIcon, Trash2Icon, FileIcon, UploadIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';

interface Attachment {
  id: string;
  filename: string;
  file_size: number | null;
  file_type: string | null;
  uploaded_by: string | null;
  created_at: string;
  download_url: string | null;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  taskId: string;
}

export function TaskAttachmentsPanel({ taskId }: Props) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function load() {
    const r = await fetch(`/api/tax-ops/tasks/${taskId}/attachments`);
    if (r.ok) {
      const body = await r.json() as { attachments: Attachment[] };
      setItems(body.attachments ?? []);
    } else {
      setItems([]);
    }
  }

  useEffect(() => { void load(); }, [taskId]);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/tax-ops/tasks/${taskId}/attachments`, {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${r.status}`);
      }
      toast.success(`${file.name} uploaded`);
      await load();
    } catch (e) {
      toast.error(`Upload failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(attachId: string, filename: string) {
    if (!confirm(`Delete "${filename}"?`)) return;
    const r = await fetch(`/api/tax-ops/tasks/${taskId}/attachments/${attachId}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      toast.error('Delete failed');
      return;
    }
    toast.success('Attachment deleted');
    await load();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  }

  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1">
        <PaperclipIcon size={12} /> Attachments
        {items && items.length > 0 && (
          <span className="ml-1 text-xs font-normal text-ink-muted">
            ({items.length})
          </span>
        )}
      </h3>

      {/* Drop-zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          'border-2 border-dashed rounded-md px-3 py-3 text-center text-xs cursor-pointer transition-colors',
          dragOver ? 'border-brand-500 bg-brand-50/40 text-brand-700' : 'border-border bg-surface-alt/30 text-ink-muted hover:border-brand-400',
          busy ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
        role="button"
        aria-label="Drop file or click to browse"
      >
        <UploadIcon size={14} className="inline mr-1" aria-hidden="true" />
        {busy
          ? 'Uploading…'
          : dragOver
            ? 'Drop the file to upload'
            : 'Drag a file here, or click to browse (max 25 MB)'}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </div>

      {/* List */}
      <div className="mt-2 space-y-1">
        {items === null && <div className="text-xs text-ink-muted italic">Loading…</div>}
        {items && items.length === 0 && (
          <div className="text-xs text-ink-faint italic">No attachments yet.</div>
        )}
        {items && items.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-alt/50 text-sm"
          >
            <FileIcon size={12} className="shrink-0 text-ink-muted" />
            {a.download_url ? (
              <a
                href={a.download_url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 text-ink hover:text-brand-700 truncate"
                title={a.filename}
              >
                {a.filename}
              </a>
            ) : (
              <span className="flex-1 text-ink truncate">{a.filename}</span>
            )}
            <span className="shrink-0 text-2xs text-ink-faint tabular-nums">{fmtSize(a.file_size)}</span>
            <span className="shrink-0 text-2xs text-ink-faint">
              {a.created_at.slice(0, 10)}
            </span>
            <button
              type="button"
              onClick={() => void remove(a.id, a.filename)}
              aria-label="Delete attachment"
              title="Delete"
              className="shrink-0 text-ink-muted hover:text-danger-600"
            >
              <Trash2Icon size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
