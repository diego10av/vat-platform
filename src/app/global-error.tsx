'use client';

// ════════════════════════════════════════════════════════════════════════
// Global (last-resort) error boundary.
//
// This catches errors thrown in the root layout — rare, but when the
// layout itself crashes, `app/error.tsx` can't render because it
// lives inside the layout. Next.js requires this file to ship its own
// <html> and <body> since nothing upstream can provide them.
//
// We keep it intentionally minimal — inline styles, no Tailwind (the
// stylesheet may itself be the thing that's broken).
// ════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#fafafa',
          color: '#111',
        }}
      >
        <div style={{ maxWidth: 520, padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: 42, marginBottom: 8 }}>⚠</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }}>
            Application crashed
          </h1>
          <p style={{ fontSize: 14, color: '#555', margin: '0 0 20px', lineHeight: 1.5 }}>
            Something went wrong in the root layout. This is a rare failure;
            reload the page to recover. If it keeps happening, copy the
            message below and reach out.
          </p>
          {error.message && (
            <pre
              style={{
                textAlign: 'left',
                background: '#fff',
                border: '1px solid #e5e5e5',
                borderRadius: 6,
                padding: '10px 12px',
                fontSize: 12,
                color: '#b00',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: '0 0 16px',
              }}
            >
              {error.message}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
          )}
          <button
            onClick={() => reset()}
            style={{
              background: '#F14E72',
              color: '#fff',
              border: 0,
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
