// ════════════════════════════════════════════════════════════════════════
// audit-humanize.ts (stint 42.A)
//
// Converts raw `audit_log` rows into a friendly "what happened" string +
// an emoji hint for the entity timeline view. Pure, no side effects.
// ════════════════════════════════════════════════════════════════════════

export interface AuditRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
  created_at: string;
}

/** Emoji prefix by action type. Falls back to · when unknown. */
export function iconFor(action: string): string {
  if (action.includes('status') || action.includes('filing_update')) return '🏷️';
  if (action.includes('merge')) return '🧩';
  if (action.includes('archive') || action.includes('deregister')) return '🗃️';
  if (action.includes('reactivate') || action.includes('restore')) return '♻️';
  if (action.includes('contact') || action.includes('bulk_set_contacts')) return '👥';
  if (action.includes('rename')) return '✏️';
  if (action.includes('create') || action === 'tax_obligation_create') return '➕';
  if (action.includes('delete') || action.includes('group_bulk_delete')) return '🗑️';
  if (action.includes('cadence')) return '🔁';
  if (action.includes('assignee') || action.includes('assigned')) return '👤';
  if (action.includes('rollover')) return '📅';
  if (action.includes('update')) return '📝';
  return '·';
}

/** Pretty-print the audit row into one human line. */
export function humanize(row: AuditRow): string {
  const { action, field, old_value, new_value, target_type } = row;

  // Field + old/new present → generic "field: old → new"
  if (field && (old_value !== null || new_value !== null)) {
    const old_ = truncate(old_value ?? '∅');
    const new_ = truncate(new_value ?? '∅');
    return `${prettyField(field)}: ${old_} → ${new_}`;
  }

  // Custom actions: try to parse new_value JSON for richer context.
  const parsed = safeParse(new_value);

  if (action === 'tax_entity_merge' && parsed) {
    const n = Array.isArray(parsed.source_entity_names) ? parsed.source_entity_names.length : 0;
    return `Merged ${n} duplicate${n === 1 ? '' : 's'} into this entity`;
  }
  if (action === 'tax_entity_contacts_bulk_set' && parsed) {
    const n = Array.isArray(parsed.contact_set) ? parsed.contact_set.length : 0;
    const src = typeof parsed.source_entity_id === 'string' ? ' from another entity' : '';
    return `Contacts replaced (${n}${src})`;
  }
  if (action === 'tax_obligation_cadence_change' && parsed) {
    return `Cadence: ${parsed.old_period_pattern} → ${parsed.new_period_pattern}`;
  }
  if (action === 'tax_client_group_bulk_delete' && parsed) {
    const names = Array.isArray(parsed.groups_deleted) ? parsed.groups_deleted.join(', ') : '';
    return `Removed from group${names ? ` (${names})` : ''}`;
  }
  if (action === 'tax_client_group_delete' && parsed?.unassigned_entities) {
    return `Family deleted (${parsed.unassigned_entities} entities unassigned)`;
  }
  if (action === 'tax_obligation_archive') return 'Obligation archived';
  if (action === 'tax_obligation_update' && parsed) {
    const keys = Object.keys(parsed);
    return `Obligation updated: ${keys.join(', ')}`;
  }

  // Fallback: just name the action.
  return prettyAction(action) + (target_type ? ` (${target_type})` : '');
}

function truncate(s: string, n = 60): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function prettyField(f: string): string {
  return f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function prettyAction(a: string): string {
  return a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Group rows by `YYYY-MM` for the timeline UI. Returns the groups in
 *  reverse-chronological order (newest month first). */
export function groupByMonth<T extends { created_at: string }>(
  rows: T[],
): Array<{ key: string; label: string; items: T[] }> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.created_at.slice(0, 7);  // YYYY-MM
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  const keys = Array.from(m.keys()).sort().reverse();
  return keys.map(k => ({
    key: k,
    label: monthLabel(k),
    items: m.get(k)!,
  }));
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11 || !y) return key;
  return `${MONTH_NAMES[idx]} ${y}`;
}
