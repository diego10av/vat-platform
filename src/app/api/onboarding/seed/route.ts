// ════════════════════════════════════════════════════════════════════════
// POST /api/onboarding/seed
//
// Creates a minimal but realistic demo dataset so a first-time user can
// click through cifra without an empty screen. NOT the full seed
// (see scripts/seed-demo.ts for that) — this is specifically:
//
//   - 1 client: "Demo Fund Client"
//   - 1 entity: a realistic LU SOPARFI with regime + frequency set
//   - 1 declaration in 'review' status
//   - 2 approvers (one primary client contact, one CSP admin)
//   - 4 invoice + invoice_line rows covering treatment variety
//     (LUX_17, RC_EU, EXEMPT_44) so the review table isn't empty
//
// Idempotent: re-runnable. Uses fixed ids prefixed `onboard-` so we
// can distinguish from the larger `demo-` seed in scripts/.
//
// Gate: only fires if the user has ZERO real clients yet. Refuses
// with 409 otherwise — we don't want to accidentally inject demo
// data into a production workspace.
// ════════════════════════════════════════════════════════════════════════

import { execute, queryOne, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';

const PREFIX = 'onboard-';
const CLIENT_ID   = `${PREFIX}client`;
const ENTITY_ID   = `${PREFIX}entity`;
const DECL_ID     = `${PREFIX}decl`;
const APPROVER_1  = `${PREFIX}app-primary`;
const APPROVER_2  = `${PREFIX}app-csp`;

export async function POST() {
  try {
    // Guard: refuse if there's already real data. We check whether
    // any non-onboarding-prefixed client exists — if so, this API
    // call is probably a mistake.
    const realClientCount = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM clients WHERE id NOT LIKE $1 AND archived_at IS NULL`,
      [`${PREFIX}%`],
    );
    if ((realClientCount?.n ?? 0) > 0) {
      return apiError('onboarding_skipped',
        'You already have clients — skipping demo seed to protect your data.',
        { hint: 'If you really want demo data, archive your real clients first.', status: 409 });
    }

    // ─── Client ───
    await execute(
      `INSERT INTO clients (id, name, kind, vat_contact_name, vat_contact_email,
           vat_contact_phone, vat_contact_role, vat_contact_country, address, notes)
       VALUES ($1, $2, 'end_client', $3, $4, $5, $6, 'LU',
         '15 Boulevard Royal, L-2449 Luxembourg',
         'Demo client auto-created for onboarding. Safe to delete once you have real clients.')
       ON CONFLICT (id) DO NOTHING`,
      [
        CLIENT_ID, 'Demo Fund Client',
        'Marie Dupont', 'marie@demofund.example',
        '+352 691 000 000', 'CFO',
      ],
    );

    // ─── Entity ───
    await execute(
      `INSERT INTO entities (
         id, client_id, name, vat_number, matricule, rcs_number,
         legal_form, entity_type, regime, frequency, address,
         has_fx, has_outgoing, has_recharges,
         notes, vat_status, client_name, client_email)
       VALUES ($1, $2, 'Demo SOPARFI SARL', 'LU99999999', '20170099999', 'B99999',
         'SARL', 'soparfi', 'simplified', 'annual',
         '15 Boulevard Royal, L-2449 Luxembourg',
         false, false, false,
         'Auto-created demo entity. You can rename or delete from /entities/[id] settings.',
         'registered', 'Marie Dupont', 'marie@demofund.example')
       ON CONFLICT (id) DO NOTHING`,
      [ENTITY_ID, CLIENT_ID],
    );

    // ─── Approvers ───
    await execute(
      `INSERT INTO entity_approvers (
         id, entity_id, name, email, role, organization, country,
         approver_type, is_primary, sort_order, notes)
       VALUES ($1, $2, 'Marie Dupont', 'marie@demofund.example', 'CFO',
         'Demo Fund Client', 'LU', 'client', true, 0,
         'Primary sign-off — the person who approves filings.')
       ON CONFLICT (id) DO NOTHING`,
      [APPROVER_1, ENTITY_ID],
    );
    await execute(
      `INSERT INTO entity_approvers (
         id, entity_id, name, email, role, organization, country,
         approver_type, is_primary, sort_order, notes)
       VALUES ($1, $2, 'Jean Weber', 'jean.weber@csp.example', 'CSP Director',
         'MetaFund Services SA', 'LU', 'csp', false, 1,
         'CSP contact — receives CC on every filing.')
       ON CONFLICT (id) DO NOTHING`,
      [APPROVER_2, ENTITY_ID],
    );

    // ─── Declaration ───
    await execute(
      `INSERT INTO declarations (id, entity_id, year, period, status, notes)
       VALUES ($1, $2, 2025, 'Y1', 'review',
         'Demo declaration — classify, approve, or delete as you explore.')
       ON CONFLICT (id) DO UPDATE SET status = 'review', updated_at = NOW()`,
      [DECL_ID, ENTITY_ID],
    );

    // ─── 4 invoices + 4 invoice_lines ───
    const invoices: Array<{
      provider: string; country: string; amount: number; vat: number;
      rate: number; description: string; treatment: string; rule: string;
    }> = [
      { provider: 'PwC Luxembourg', country: 'LU', amount: 3200, vat: 544, rate: 0.17,
        description: 'Tax advisory retainer', treatment: 'LUX_17', rule: 'RULE 1' },
      { provider: 'Bloomberg L.P.', country: 'US', amount: 5400, vat: 0, rate: 0,
        description: 'Terminal subscription', treatment: 'RC_NONEU_TAX', rule: 'RULE 5' },
      { provider: 'HSBC Private Banking', country: 'LU', amount: 4500, vat: 0, rate: 0,
        description: 'Custody fees', treatment: 'EXEMPT_44', rule: 'RULE 2' },
      { provider: 'LinkedIn Ireland', country: 'IE', amount: 1500, vat: 0, rate: 0,
        description: 'Recruiting services', treatment: 'RC_EU_TAX', rule: 'RULE 4' },
    ];

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const invId = `${PREFIX}inv-${i + 1}`;
      const lineId = `${PREFIX}line-${i + 1}`;
      const amountIncl = inv.amount + inv.vat;

      await execute(
        `INSERT INTO invoices (id, document_id, declaration_id, provider, country,
           direction, invoice_date, invoice_number, currency, currency_amount,
           total_ex_vat, total_vat, total_incl_vat, extraction_source)
         VALUES ($1, NULL, $2, $3, $4, 'incoming',
           CURRENT_DATE - INTERVAL '30 days', $5, 'EUR', NULL,
           $6, $7, $8, 'demo_seed')
         ON CONFLICT (id) DO NOTHING`,
        [
          invId, DECL_ID, inv.provider, inv.country,
          `INV-${1000 + i}`,
          inv.amount, inv.vat, amountIncl,
        ],
      );
      await execute(
        `INSERT INTO invoice_lines (id, invoice_id, declaration_id, description,
           amount_eur, vat_rate, vat_applied, rc_amount, amount_incl,
           treatment, treatment_source, classification_rule, ai_confidence,
           ai_suggested_treatment, ai_suggested_rule,
           sort_order, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8,
           $9, 'rule', $10, 0.98,
           $9, $10,
           $11, 'classified')
         ON CONFLICT (id) DO NOTHING`,
        [
          lineId, invId, DECL_ID, inv.description,
          inv.amount, inv.rate, inv.vat, amountIncl,
          inv.treatment, inv.rule,
          i,
        ],
      );
    }

    await logAudit({
      entityId: ENTITY_ID,
      declarationId: DECL_ID,
      action: 'seed', targetType: 'onboarding', targetId: CLIENT_ID,
      newValue: 'demo-onboarding-seed v1',
    });

    return apiOk({
      ok: true,
      client_id: CLIENT_ID,
      entity_id: ENTITY_ID,
      declaration_id: DECL_ID,
      message: 'Demo data created — click Clients in the sidebar to explore.',
    });
  } catch (err) {
    return apiFail(err, 'onboarding/seed');
  }
}
