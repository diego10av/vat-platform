'use client';

// ════════════════════════════════════════════════════════════════════════
// /crm — layout shared by all sub-routes of the CRM module.
//
// Stint 65.C — top-tabs removed (same change as /tax-ops/layout.tsx).
// The 8-tab strip duplicated the sidebar 1-for-1: every tab has a
// matching sidebar item under the CRM parent. Diego's UX audit
// (2026-04-30): "triple navegación redundante". Linear / Notion canon
// is one nav surface (sidebar). The 56px we're returning to the page
// matters on dense /crm/billing and matter-detail layouts.
//
// Trash / Settings / Help routes still exist (unchanged) — they're
// reachable via direct URL and the user menu. GlobalSearch + the
// CRM Quick-Create modal stay at the layout level so any /crm/* page
// gets ⌘K and N keyboard shortcuts.
// ════════════════════════════════════════════════════════════════════════

import { GlobalSearch } from '@/components/crm/GlobalSearch';
import { CrmQuickCreateModal } from '@/components/crm/CrmQuickCreateModal';

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[1400px] mx-auto px-4 pt-4">
      <GlobalSearch />
      <div>{children}</div>
      {/* Stint 63.B — global quick-create modal. Press N from any
          /crm/* page to create a Company / Contact / Opportunity / Task
          without navigating to its tab first. */}
      <CrmQuickCreateModal />
    </div>
  );
}
