'use client';

// ════════════════════════════════════════════════════════════════════════
// Global keyboard shortcuts — stint 12 extra #6.
//
// Three scopes:
//
//   1. GLOBAL (this provider, always-on):
//        ?       → open shortcuts help overlay
//        g then h → go to home
//        g then c → go to clients
//        g then d → go to declarations
//        g then l → legal watch (admin/reviewer)
//        g then s → settings (admin/reviewer)
//        ESC      → close any open overlay (handled by Modal primitive)
//
//   2. CONTEXTUAL (declaration page — registered via useRowNav hook):
//        j / ↓    → next row
//        k / ↑    → previous row
//        a        → approve declaration (when in review, all clean)
//        r        → reopen (with confirm)
//        /        → focus search / filter
//
//   3. MODAL-SCOPED: ESC closes (implemented in Modal primitive)
//
// Inputs respect the standard "don't hijack when typing":
//   - If the target is an <input>, <textarea>, <select>, or has
//     contenteditable, we bail out.
//   - ⌘K is still owned by SearchBar (doesn't route through here).
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';

function isTypingInInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (t.isContentEditable) return true;
  return false;
}

export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingLeader, setPendingLeader] = useState<string | null>(null);

  const goTo = useCallback((path: string) => {
    setPendingLeader(null);
    router.push(path);
  }, [router]);

  // Clear a stale leader key (g) after 1.2s if no second key follows.
  useEffect(() => {
    if (!pendingLeader) return;
    const t = setTimeout(() => setPendingLeader(null), 1200);
    return () => clearTimeout(t);
  }, [pendingLeader]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Modifier-keyed shortcuts handled elsewhere (⌘K in SearchBar).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingInInput(e)) return;

      const key = e.key;

      // "?" → help overlay (shift+/ on most layouts).
      if (key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // Two-stroke "g x" leader shortcuts.
      if (pendingLeader === 'g') {
        const targetKey = key.toLowerCase();
        switch (targetKey) {
          case 'h': e.preventDefault(); goTo('/'); return;
          case 'c': e.preventDefault(); goTo('/clients'); return;
          case 'e': e.preventDefault(); goTo('/entities'); return;
          case 'd': e.preventDefault(); goTo('/declarations'); return;
          case 't': e.preventDefault(); goTo('/tax-ops'); return;
          case 'l': e.preventDefault(); goTo('/legal-watch'); return;
          case 's': e.preventDefault(); goTo('/settings'); return;
          case 'a': e.preventDefault(); goTo('/audit'); return;
          case 'i': e.preventDefault(); goTo('/aed-letters'); return;
          case 'p': e.preventDefault(); goTo('/closing'); return;
          default:
            setPendingLeader(null);
            return;
        }
      }

      if (key.toLowerCase() === 'g') {
        // Start the leader sequence.
        e.preventDefault();
        setPendingLeader('g');
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingLeader, goTo]);

  return (
    <>
      {children}

      {/* Subtle leader-key hint */}
      {pendingLeader === 'g' && (
        <div className="fixed bottom-4 left-4 z-[95] bg-ink text-white rounded-md px-3 py-2 text-[11.5px] flex items-center gap-2 shadow-lg animate-fadeIn pointer-events-none">
          <kbd className="font-mono bg-white/10 rounded px-1 py-0.5">g</kbd>
          <span>then</span>
          <kbd className="font-mono bg-white/10 rounded px-1 py-0.5">h</kbd>
          <span className="text-white/60">home</span>
          <kbd className="font-mono bg-white/10 rounded px-1 py-0.5">c</kbd>
          <span className="text-white/60">clients</span>
          <kbd className="font-mono bg-white/10 rounded px-1 py-0.5">d</kbd>
          <span className="text-white/60">declarations</span>
          <span className="text-white/30">· ESC cancel</span>
        </div>
      )}

      {/* Help overlay (?-key) */}
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Keyboard shortcuts"
        subtitle="cifra is built for keyboard power users — these are the core moves."
        size="lg"
      >
        <ShortcutsHelp currentPath={pathname} />
      </Modal>
    </>
  );
}

function ShortcutsHelp({ currentPath }: { currentPath: string }) {
  return (
    <div className="space-y-5 text-[12.5px]">
      <Section title="Global">
        <Row keys={['⌘', 'K']} desc="Open command palette · search + actions" />
        <Row keys={['?']} desc="Open this help overlay" />
        <Row keys={['g', 'h']} desc="Go to Home" />
        <Row keys={['g', 'c']} desc="Go to Clients" />
        <Row keys={['g', 'e']} desc="Go to Entities" />
        <Row keys={['g', 'd']} desc="Go to Declarations" />
        <Row keys={['g', 't']} desc="Go to Tax-Ops overview (CIT · NWT · VAT · WHT · BCL · …)" />
        <Row keys={['g', 'i']} desc="Go to AED inbox" />
        <Row keys={['g', 'p']} desc="Go to Closing dashboard (current quarter)" />
        <Row keys={['g', 'l']} desc="Go to Legal watch (admin / reviewer)" />
        <Row keys={['g', 'a']} desc="Go to Audit (admin / reviewer)" />
        <Row keys={['g', 's']} desc="Go to Settings (admin / reviewer)" />
        <Row keys={['Esc']} desc="Close modal / dismiss toast" />
      </Section>

      {currentPath.startsWith('/declarations/') && currentPath !== '/declarations' && (
        <Section title="Declaration page">
          <Row keys={['j']} desc="Move selection down one row" />
          <Row keys={['k']} desc="Move selection up one row" />
          <Row keys={['↵']} desc="Open the selected row's preview" />
          <Row keys={['/']} desc="Focus search / filter" />
          <Row keys={['a']} desc="Approve declaration (needs all lines clean)" />
          <Row keys={['r']} desc="Reopen declaration (confirms)" />
          <div className="text-[11px] text-ink-muted mt-2 italic">
            Row-level shortcuts are active only while the Review tab is focused.
          </div>
        </Section>
      )}

      <Section title="Command palette ⌘K">
        <div className="text-[12px] text-ink-soft">
          Type to filter actions + search. Matches against entities,
          declarations, providers, and 13 built-in verbs (Create client,
          Go to classifier, etc.). Hit <kbd className="text-[10.5px] px-1 py-0.5 rounded bg-surface-alt border border-border font-mono">Enter</kbd> to run.
        </div>
      </Section>

      <div className="pt-3 border-t border-divider text-[11px] text-ink-muted">
        Missing a shortcut? Open Feedback
        (<kbd className="text-[10px] px-1 py-0.5 rounded bg-surface-alt border border-border font-mono">Shift + ?</kbd>
        {' '}then click <em>Feedback</em>) and we'll add it.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-2">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0 flex items-center gap-1 min-w-[100px]">
        {keys.map((k, i) => (
          <span key={i}>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-surface-alt border border-border font-mono text-[11px] font-semibold">
              {k}
            </kbd>
            {i < keys.length - 1 && <span className="text-ink-faint text-[10px] mx-0.5">then</span>}
          </span>
        ))}
      </div>
      <span className="text-ink-soft">{desc}</span>
    </div>
  );
}
