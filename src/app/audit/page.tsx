'use client';

// Stint 67.B.b: per-page force-dynamic — see /clients/page.tsx.
export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FileSearchIcon, XIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Stat } from '@/components/ui/Stat';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeleton';

interface AuditRow {
  id: string; user_id: string | null; entity_id: string | null; declaration_id: string | null;
  action: string; target_type: string; target_id: string;
  field: string | null; old_value: string | null; new_value: string | null;
  created_at: string; entity_name: string | null; year: number | null; period: string | null;
}
interface ActionCount { action: string; n: number }
interface AuditResponse { rows: AuditRow[]; actions: string[]; counts: ActionCount[] }

export default function AuditPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuditContent />
    </Suspense>
  );
}

function AuditContent() {
  const sp = useSearchParams();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [actionFilter, setActionFilter] = useState(sp.get('action') || '');
  const [entityFilter] = useState(sp.get('entity_id') || '');
  const [declFilter] = useState(sp.get('declaration_id') || '');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (actionFilter) params.set('action', actionFilter);
    if (entityFilter) params.set('entity_id', entityFilter);
    if (declFilter) params.set('declaration_id', declFilter);
    const res = await fetch(`/api/audit?${params}`);
    setData(await res.json());
  }, [actionFilter, entityFilter, declFilter]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <PageSkeleton />;

  const visible = data.rows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.entity_name, r.target_type, r.field, r.old_value, r.new_value, r.target_id]
      .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  });

  const hasFilters = !!(actionFilter || search);

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Every create, update, delete, classification, approval, filing, and payment is recorded here for compliance."
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <Stat label="Total events" value={data.counts.reduce((s, c) => s + c.n, 0)} />
        {data.counts.slice(0, 3).map(c => (
          <Stat key={c.action} label={c.action} value={c.n} tone="muted" />
        ))}
      </div>

      <Card className="p-3 mb-4 flex items-end gap-3 flex-wrap">
        <Field label="Search" className="flex-1 min-w-[200px]">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search target, field, or value…" />
        </Field>
        <Field label="Action">
          <Select value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
            <option value="">All actions</option>
            {data.actions.map(a => <option key={a} value={a}>{a}</option>)}
          </Select>
        </Field>
        {hasFilters && (
          <Button variant="ghost" icon={<XIcon size={12} />} onClick={() => { setActionFilter(''); setSearch(''); }}>
            Clear
          </Button>
        )}
      </Card>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState icon={<FileSearchIcon size={22} />} title="No events match" description="Try loosening the filters." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-divider text-ink-muted">
              <tr>
                <Th>Time</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Entity</Th>
                <Th>Period</Th>
                <Th>Field</Th>
                <Th>Change</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id} className="border-b border-divider last:border-0 hover:bg-surface-alt/50 transition-colors duration-150">
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap text-xs">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-2.5"><ActionPill action={r.action} /></td>
                  <td className="px-4 py-2.5 text-ink-soft font-mono text-xs">{r.target_type}</td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    {r.entity_name ? (
                      <Link href={`/entities/${r.entity_id}`} className="hover:text-brand-600 transition-colors">{r.entity_name}</Link>
                    ) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    {r.year && r.period ? <Link href={`/declarations/${r.declaration_id}`} className="hover:text-brand-600 transition-colors">{r.year} {r.period}</Link> : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft font-mono text-xs">{r.field || '—'}</td>
                  <td className="px-4 py-2.5 text-ink-soft max-w-md"><ChangeView old={r.old_value} new_={r.new_value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-medium text-2xs uppercase tracking-[0.06em]">{children}</th>;
}

function ChangeView({ old: oldV, new_: newV }: { old: string | null; new_: string | null }) {
  if (!oldV && !newV) return <span className="text-ink-faint">—</span>;
  if (!oldV) return <span className="text-success-700">+ {truncate(newV || '', 80)}</span>;
  if (!newV) return <span className="text-danger-700 line-through">- {truncate(oldV, 80)}</span>;
  return (
    <span className="text-xs">
      <span className="text-danger-700 line-through">{truncate(oldV, 40)}</span>
      <span className="text-ink-faint mx-1.5">→</span>
      <span className="text-success-700">{truncate(newV, 40)}</span>
    </span>
  );
}

function ActionPill({ action }: { action: string }) {
  const map: Record<string, 'success' | 'info' | 'danger' | 'teal' | 'warning' | 'violet' | 'amber' | 'brand' | 'neutral'> = {
    create: 'success', update: 'info', delete: 'danger',
    approve: 'success', file: 'teal', pay: 'success', reopen: 'warning',
    classify: 'violet', extract: 'amber', triage: 'brand', restore: 'info',
  };
  return <Badge tone={map[action] || 'neutral'}>{action}</Badge>;
}

function formatDateTime(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
