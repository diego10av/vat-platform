'use client';

// ════════════════════════════════════════════════════════════════════════
// PreviewPanel — sticky right-side panel showing the source document
// (PDF or image) for the currently-highlighted invoice line.
//
// Extracted from page.tsx during the 2026-04-18 refactor. No behaviour
// changes — verbatim move with imports rewired.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import type { PreviewTarget } from './_types';
import { IconBtn, Spinner } from './_atoms';

export function PreviewPanel({
  preview, onClose,
}: { preview: PreviewTarget; onClose: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [fileType, setFileType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<'fit-width' | 'fit-page' | number>('fit-width');

  useEffect(() => {
    if (!preview) return;
    setZoom('fit-width');
    if (preview.kind !== 'document') { setSignedUrl(null); return; }
    setLoading(true); setError(null); setSignedUrl(null);
    fetch(`/api/documents/${preview.documentId}/url`)
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error || 'Failed'); return r.json(); })
      .then(d => { setSignedUrl(d.url); setFilename(d.filename); setFileType(d.file_type); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [preview]);

  if (!preview) return null;

  const pdfSrc = fileType === 'pdf' && signedUrl
    ? `${signedUrl}#view=${zoom === 'fit-page' ? 'FitH' : 'FitH'}&toolbar=1`
    : signedUrl;

  const zoomPct = typeof zoom === 'number' ? zoom : (zoom === 'fit-width' ? 1 : 0.9);

  return (
    <div className="sticky top-2 flex flex-col border border-border rounded-lg overflow-hidden bg-surface shadow-sm" style={{ height: 'calc(100vh - 96px)' }}>
      {/* Toolbar */}
      <div className="px-3 h-10 border-b border-border flex items-center justify-between bg-surface">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon type={fileType || 'pdf'} />
          <span className="text-[12px] font-medium truncate text-gray-800">
            {preview.kind === 'manual' ? 'No source document' : (filename || 'Loading…')}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {(fileType === 'image' || fileType === 'pdf') && signedUrl && (
            <>
              <IconBtn title="Zoom out" onClick={() => setZoom(z => typeof z === 'number' ? Math.max(0.25, z - 0.25) : 0.75)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
              </IconBtn>
              <IconBtn title="Zoom in" onClick={() => setZoom(z => typeof z === 'number' ? Math.min(4, z + 0.25) : 1.25)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
              </IconBtn>
              <IconBtn title="Fit width" onClick={() => setZoom('fit-width')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18"/><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/></svg>
              </IconBtn>
              <IconBtn title="Fit page" onClick={() => setZoom('fit-page')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              </IconBtn>
              <div className="w-px h-5 bg-gray-200 mx-1" />
            </>
          )}
          {signedUrl && preview.kind === 'document' && (
            <IconBtn title="Open in new tab" onClick={() => window.open(signedUrl, '_blank', 'noopener')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </IconBtn>
          )}
          <IconBtn title="Close (Esc)" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </IconBtn>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-surface-alt">
        {preview.kind === 'manual' ? (
          <ManualPlaceholder />
        ) : loading ? (
          <div className="flex items-center justify-center h-full"><Spinner /></div>
        ) : error ? (
          <div className="p-4 text-[12px] text-red-600 bg-red-50 border-b border-red-200">Error: {error}</div>
        ) : signedUrl ? (
          fileType === 'image' ? (
            <div className="flex items-start justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signedUrl} alt={filename}
                style={{
                  transform: typeof zoom === 'number' ? `scale(${zoom})` : undefined,
                  transformOrigin: 'top center',
                  maxWidth: zoom === 'fit-width' ? '100%' : 'none',
                  maxHeight: zoom === 'fit-page' ? '100%' : 'none',
                }}
                className="bg-surface shadow-sm" />
            </div>
          ) : fileType === 'pdf' ? (
            <iframe src={pdfSrc!} className="w-full h-full bg-surface" title={filename} />
          ) : (
            <div className="p-4 text-[12px] text-ink-soft">
              <a href={signedUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Download to preview</a>.
            </div>
          )
        ) : null}
      </div>

      {/* Footer hint */}
      <div className="px-3 h-7 border-t border-border text-[10px] text-ink-faint flex items-center justify-between bg-surface-alt">
        <span>↑/↓ to navigate · Esc to close{typeof zoom === 'number' ? ` · zoom ${Math.round(zoomPct * 100)}%` : ''}</span>
        {preview.kind === 'document' && signedUrl && (
          <a href={signedUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
            Open full size ↗
          </a>
        )}
      </div>
    </div>
  );
}

function ManualPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full bg-surface-alt p-8 text-center">
      <div>
        <div className="w-12 h-12 mx-auto rounded-full bg-gray-200 flex items-center justify-center mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </div>
        <div className="text-[13px] font-medium text-ink-soft">No source document</div>
        <div className="text-[11px] text-ink-muted mt-1 max-w-[260px] mx-auto">
          This entry was added manually — it is an outgoing invoice issued by the entity.
        </div>
      </div>
    </div>
  );
}

// FileIcon is local to the preview panel since only the toolbar uses it.
// The DocRow in the main page has its own visual element.
function FileIcon({ type }: { type: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint shrink-0">
      {type === 'image' ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </>
      ) : (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </>
      )}
    </svg>
  );
}
