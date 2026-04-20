// Client-side helpers to consume the api-errors envelope and render it.
//
// Two-layer humanising:
//
//   1. `describeApiError(res)` — parses the Response JSON into a
//      structured { code, message, hint } triple. Uses the server's
//      message when present, otherwise the fallback.
//
//   2. `humaniseError({ code, message, hint })` — translates known
//      error codes into reviewer-friendly messages + suggested next
//      actions. If the code isn't mapped, we fall back to the server
//      message (never the raw code).
//
// The humanise layer is the cure for "toast shows `has_entities`"
// (Gassner audit item #5, 2026-04-19). The server already carries
// a `message` for each apiError, but some messages are terse or use
// internal vocabulary — the map below translates those into phrases
// a reviewer would read and immediately know what to do next.

export type UiError = { code: string; message: string; hint?: string };

/**
 * Parse a fetch() Response into a structured { code, message, hint }.
 *
 * Kept close to the raw server envelope so unit tests can assert the
 * parse rules. Call sites should feed the result through
 * `humaniseError()` (or use `formatUiError()` which humanises
 * automatically) before displaying text to a user.
 */
export async function describeApiError(res: Response, fallback = 'Request failed'): Promise<UiError> {
  let code = `http_${res.status}`;
  let message = fallback;
  let hint: string | undefined;
  try {
    const body = await res.clone().json();
    const e = body?.error;
    if (e && typeof e === 'object') {
      if (typeof e.code === 'string') code = e.code;
      if (typeof e.message === 'string') message = e.message;
      if (typeof e.hint === 'string') hint = e.hint;
    } else if (typeof body?.error === 'string') {
      if (typeof body?.message === 'string') {
        // Shape B: `{ error: 'code', message: 'human text' }` — the new
        // declaration/invoice DELETE envelopes use this.
        code = body.error;
        message = body.message;
      } else {
        // Shape C: bare `{ error: 'string' }` — historical behaviour,
        // treat the string as the human message; leave the code as
        // http_{status} so the humaniser doesn't try to translate it.
        message = body.error;
      }
    }
  } catch {
    // Not JSON — use fallback
  }
  return { code, message, hint };
}

/**
 * Map known server error codes to reviewer-friendly messages. The
 * server's `message` is kept as-is when the code isn't in the map.
 */
export function humaniseError(e: UiError): UiError {
  const mapped = ERROR_MAP[e.code];
  if (!mapped) return e;
  return {
    code: e.code,
    message: mapped.message,
    hint: mapped.hint ?? e.hint,
  };
}

/**
 * Format an error for display. Automatically runs the humaniser so
 * call sites get the reviewer-friendly text without remembering to
 * chain helpers.
 */
export function formatUiError(e: UiError): string {
  const h = humaniseError(e);
  return h.hint ? `${h.message} ${h.hint}` : h.message;
}

// ─────────────────── The humanise dictionary ───────────────────
// Keyed on the server's apiError code. Each entry carries a
// replacement message + optional hint. The hint tells the reviewer
// what to do next; the message never surfaces the internal code.
//
// Keep entries sorted alphabetically so adding new codes is painless.

const ERROR_MAP: Record<string, { message: string; hint?: string }> = {
  ai_mode_invalid: {
    message: 'The AI mode value is not one of the allowed options.',
    hint: 'Pick either "Full AI" or "Classifier only" on the entity\'s AI mode card.',
  },
  ai_mode_restricted: {
    message: 'This action requires full AI on this entity.',
    hint: 'Open the entity\'s AI mode card and switch from "Classifier only" to "Full AI", then retry.',
  },
  attachment_not_found: {
    message: 'That attachment is no longer available.',
    hint: 'Someone may have removed it — refresh the page to see the current list.',
  },
  bad_category: { message: 'That letter category is not in the supported list.' },
  bad_display_name: { message: 'The display name can\'t be empty.' },
  bad_email: {
    message: 'That email address doesn\'t look valid.',
    hint: 'Expected format: name@domain.tld',
  },
  bad_id: { message: 'The record ID is missing or malformed.' },
  bad_json: { message: 'The request body couldn\'t be parsed as JSON.' },
  bad_kind: { message: 'That client kind is not one of end_client / csp / other.' },
  bad_method: {
    message: 'Pick one of the three pro-rata methods: General ratio, Direct attribution, or Sector ratios.',
  },
  bad_name: { message: 'The name field is required and can\'t be blank.' },
  bad_period: {
    message: 'The period end must be on or after the period start.',
    hint: 'Check the dates in the pro-rata configuration.',
  },
  bad_period_end: { message: 'The period end date must be in YYYY-MM-DD format.' },
  bad_period_start: { message: 'The period start date must be in YYYY-MM-DD format.' },
  bad_ratio_denom: { message: 'The denominator must be a non-negative number.' },
  bad_ratio_num: { message: 'The numerator must be a non-negative number.' },
  bad_ratio_pct: { message: 'The ratio percentage must be between 0 and 100.' },
  bad_role: {
    message: 'That role is not one of the allowed values.',
    hint: 'Pick Admin, Reviewer, Junior, Client or Member.',
  },
  bad_status: { message: 'That declaration status is not valid.' },
  bad_title: { message: 'The title field can\'t be blank.' },
  bad_type: { message: 'That attachment type is not recognised.' },
  bad_url: { message: 'That URL isn\'t valid.' },
  budget_exhausted: {
    message: 'The Anthropic monthly budget for this firm is exhausted.',
    hint: 'Ask the admin to raise the budget in /settings or wait until next month.',
  },
  declaration_id_required: { message: 'No declaration was selected — cannot continue.' },
  declaration_locked: {
    message: 'This declaration is already approved / filed / paid — it can\'t be modified directly.',
    hint: 'Click "Reopen" (or "Un-file & reopen" for filed declarations) first, then make your changes.',
  },
  declaration_not_found: { message: 'That declaration no longer exists. Go back to the list and refresh.' },
  direction_invalid: { message: 'Direction must be either "incoming" or "outgoing".' },
  download_failed: {
    message: 'The file couldn\'t be downloaded right now.',
    hint: 'Retry in a few seconds — if it keeps failing, the file may have been removed.',
  },
  duplicate_name: {
    message: 'A record with this name already exists.',
    hint: 'Pick a different name or edit the existing record instead.',
  },
  empty_patch: { message: 'Nothing was changed.' },
  entity_not_found: { message: 'That entity no longer exists. Go back to the list and refresh.' },
  field_not_bulkable: {
    message: 'That field cannot be updated in bulk.',
    hint: 'Edit one row at a time for this field.',
  },
  file_required: { message: 'Select a file to upload first.' },
  file_too_large: {
    message: 'The file is larger than the upload limit.',
    hint: 'Maximum size is 20 MB per file. Split the PDF or compress large images.',
  },
  filing_ref_required: {
    message: 'A filing reference is required when moving a declaration to "Filed".',
    hint: 'Paste the AED-provided filing reference in the Filing panel before you submit.',
  },
  finding_not_found: { message: 'That validator finding no longer exists.' },
  forbidden: {
    message: 'Your account doesn\'t have access to this page.',
    hint: 'Ask an administrator to upgrade your role if you think this is wrong.',
  },
  has_entities: {
    message: 'This client still owns entities and can\'t be archived yet.',
    hint: 'Move or archive the entities first, then retry the archive.',
  },
  invoice_not_found: { message: 'That invoice no longer exists. Refresh the page to see the current list.' },
  job_not_found: { message: 'The background job finished or was cancelled — nothing to cancel now.' },
  kind_invalid: { message: 'That kind is not recognised.' },
  line_not_found: { message: 'That invoice line no longer exists. Refresh to see the current rows.' },
  no_changes: { message: 'Nothing to save — you haven\'t changed any fields.' },
  not_found: { message: 'Not found. Refresh the page and try again.' },
  primary_exists: {
    message: 'There\'s already a primary approver on this entity.',
    hint: 'Demote the current primary first, or add this person as a secondary approver.',
  },
  rate_limit: {
    message: 'Too many requests in a short time.',
    hint: 'Wait 30 seconds and try again.',
  },
  role_restricted: {
    message: 'Your role doesn\'t give access to this page.',
    hint: 'Contact your admin if you think this is wrong.',
  },
  schema_missing: {
    message: 'A database migration is pending.',
    hint: 'This is an admin-only setup step — contact the admin for this workspace.',
  },
  unauthorized: {
    message: 'You\'re not signed in.',
    hint: 'Refresh the page to sign in again.',
  },
};
