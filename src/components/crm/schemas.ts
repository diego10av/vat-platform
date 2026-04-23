// ════════════════════════════════════════════════════════════════════════
// Field schemas for CrmFormModal. One per entity type.
//
// Keep these in sync with the DB columns + API route UPDATABLE_FIELDS
// whitelists. When adding a new column, update:
//   1. Migration SQL
//   2. API POST + PUT whitelist
//   3. This schema
//   4. The list / detail page render logic
// ════════════════════════════════════════════════════════════════════════

import {
  COMPANY_CLASSIFICATIONS, COMPANY_INDUSTRIES, COMPANY_SIZES,
  LABELS_CLASSIFICATION, LABELS_INDUSTRY, LABELS_SIZE,
  CONTACT_LIFECYCLES, LABELS_LIFECYCLE,
  ENGAGEMENT_LEVELS, LABELS_ENGAGEMENT,
  OPPORTUNITY_STAGES, LABELS_STAGE,
  MATTER_STATUSES, LABELS_MATTER_STATUS,
  ACTIVITY_TYPES, LABELS_ACTIVITY_TYPE,
  TASK_STATUSES, LABELS_TASK_STATUS,
  TASK_PRIORITIES, LABELS_TASK_PRIORITY,
  INVOICE_STATUSES, LABELS_INVOICE_STATUS,
} from '@/lib/crm-types';
import type { FieldSchema } from './CrmFormModal';

const asOptions = <T extends string>(arr: readonly T[], labels: Record<T, string>) =>
  arr.map(v => ({ value: v, label: labels[v] }));

// ISO-3166-alpha-2 catalogue — common markets for a LU/EU PE firm.
const COUNTRIES = [
  { value: 'LU', label: 'Luxembourg' },
  { value: 'FR', label: 'France' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'IE', label: 'Ireland' },
  { value: 'DE', label: 'Germany' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' },
  { value: 'PT', label: 'Portugal' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'FI', label: 'Finland' },
  { value: 'SE', label: 'Sweden' },
  { value: 'DK', label: 'Denmark' },
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'BR', label: 'Brazil' },
  { value: 'HK', label: 'Hong Kong' },
  { value: 'SG', label: 'Singapore' },
];

const PRACTICE_AREAS = [
  { value: 'real_estate',     label: 'Real Estate' },
  { value: 'litigation',      label: 'Litigation' },
  { value: 'employment',      label: 'Employment' },
  { value: 'fund_regulatory', label: 'Fund/Regulatory' },
  { value: 'tax',             label: 'Tax' },
  { value: 'm_a',             label: 'M&A' },
];

const FEE_TYPES = [
  { value: 'retainer',    label: 'Retainer' },
  { value: 'success_fee', label: 'Success fee' },
  { value: 'fixed_fee',   label: 'Fixed fee' },
  { value: 'hourly',      label: 'Hourly' },
];

const LOSS_REASONS = [
  { value: 'no_response',          label: 'No response' },
  { value: 'competitor',           label: 'Competitor won' },
  { value: 'conflict_of_interest', label: 'Conflict of interest' },
  { value: 'price',                label: 'Price' },
  { value: 'other',                label: 'Other' },
];

const AREAS = [
  { value: 'real_estate',     label: 'Real Estate' },
  { value: 'litigation',      label: 'Litigation' },
  { value: 'employment',      label: 'Employment' },
  { value: 'fund_regulatory', label: 'Fund/Regulatory' },
  { value: 'tax',             label: 'Tax' },
  { value: 'm_a',             label: 'M&A' },
];

const ROLE_TAGS = [
  { value: 'main_poc',         label: 'Main POC' },
  { value: 'decision_maker',   label: 'Decision maker' },
  { value: 'billing_contact',  label: 'Billing contact' },
  { value: 'referrer',         label: 'Referrer' },
  { value: 'internal',         label: 'Internal' },
  { value: 'opposing_party',   label: 'Opposing party' },
];

const SOURCES = [
  { value: 'referral',         label: 'Referral' },
  { value: 'linkedin',         label: 'LinkedIn' },
  { value: 'event',            label: 'Event' },
  { value: 'website',          label: 'Website' },
  { value: 'cold_call',        label: 'Cold call / email' },
  { value: 'service_provider', label: 'Service provider' },
  { value: 'friend',           label: 'Friend' },
  { value: 'other',            label: 'Other' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'lu', label: 'Luxembourgish' },
];

const CONSENT_STATUSES = [
  { value: 'explicit',  label: 'Explicit' },
  { value: 'implicit',  label: 'Implicit' },
  { value: 'none',      label: 'None' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

// ────────────────────────── Company schema ────────────────────────────

export const COMPANY_FIELDS: FieldSchema[] = [
  {
    name: 'company_name',
    label: 'Company name',
    type: 'text',
    required: true,
    placeholder: 'e.g. Blackstone Luxembourg S.à r.l.',
    maxLength: 200,
  },
  {
    name: 'classification',
    label: 'Classification',
    type: 'select',
    options: asOptions(COMPANY_CLASSIFICATIONS, LABELS_CLASSIFICATION),
    help: 'KAM tier — Key Account for top strategic clients.',
  },
  {
    name: 'country',
    label: 'Country',
    type: 'select',
    options: COUNTRIES,
  },
  {
    name: 'industry',
    label: 'Industry',
    type: 'select',
    options: asOptions(COMPANY_INDUSTRIES, LABELS_INDUSTRY),
  },
  {
    name: 'size',
    label: 'Size',
    type: 'select',
    options: asOptions(COMPANY_SIZES, LABELS_SIZE),
  },
  {
    name: 'website',
    label: 'Website',
    type: 'url',
    placeholder: 'https://...',
  },
  {
    name: 'linkedin_url',
    label: 'LinkedIn',
    type: 'url',
    placeholder: 'https://linkedin.com/company/...',
  },
  {
    name: 'tags',
    label: 'Tags',
    type: 'tags',
    help: 'Free-form segments: "PE-fund", "Portfolio-company", "Inherited-from-X".',
  },
  {
    name: 'notes',
    label: 'Notes',
    type: 'textarea',
    placeholder: 'Relationship history, preferences, context...',
  },
];

// ────────────────────────── Contact schema ────────────────────────────

export const CONTACT_FIELDS: FieldSchema[] = [
  {
    name: 'full_name',
    label: 'Full name',
    type: 'text',
    required: true,
    maxLength: 150,
  },
  {
    name: 'job_title',
    label: 'Job title',
    type: 'text',
    maxLength: 150,
  },
  {
    name: 'email',
    label: 'Email',
    type: 'email',
    placeholder: 'name@firm.com',
  },
  {
    name: 'phone',
    label: 'Phone',
    type: 'tel',
  },
  {
    name: 'linkedin_url',
    label: 'LinkedIn',
    type: 'url',
    placeholder: 'https://linkedin.com/in/...',
  },
  {
    name: 'country',
    label: 'Country',
    type: 'select',
    options: COUNTRIES,
  },
  {
    name: 'preferred_language',
    label: 'Preferred language',
    type: 'select',
    options: LANGUAGES,
    help: 'Language used when drafting emails to this contact.',
  },
  {
    name: 'lifecycle_stage',
    label: 'Lifecycle stage',
    type: 'select',
    options: asOptions(CONTACT_LIFECYCLES, LABELS_LIFECYCLE),
    help: 'Lead → Prospect → Customer → Former customer.',
  },
  {
    name: 'role_tags',
    label: 'Role tags',
    type: 'multiselect',
    options: ROLE_TAGS,
    placeholder: 'Select all roles that apply.',
  },
  {
    name: 'areas_of_interest',
    label: 'Areas of interest',
    type: 'multiselect',
    options: AREAS,
    placeholder: 'Which of our practice areas interest this contact?',
  },
  {
    name: 'source',
    label: 'How we met',
    type: 'select',
    options: SOURCES,
  },
  {
    name: 'engagement_override',
    label: 'Engagement override',
    type: 'select',
    options: asOptions(ENGAGEMENT_LEVELS, LABELS_ENGAGEMENT),
    help: 'Manually force Active/Dormant/Lapsed. Leave empty for auto-computed.',
  },
  {
    name: 'consent_status',
    label: 'GDPR consent',
    type: 'select',
    options: CONSENT_STATUSES,
  },
  {
    name: 'next_follow_up',
    label: 'Next follow-up',
    type: 'date',
  },
  {
    name: 'tags',
    label: 'Tags',
    type: 'tags',
  },
  {
    name: 'notes',
    label: 'Notes',
    type: 'textarea',
  },
];

// ────────────────────────── Opportunity schema ────────────────────────

export const OPPORTUNITY_FIELDS: FieldSchema[] = [
  {
    name: 'name',
    label: 'Opportunity name',
    type: 'text',
    required: true,
    placeholder: 'e.g. Fund II formation — Q4 2025',
  },
  {
    name: 'stage',
    label: 'Stage',
    type: 'select',
    required: true,
    options: asOptions(OPPORTUNITY_STAGES, LABELS_STAGE),
    help: 'Salesforce-style pipeline — changing stage auto-updates stage_entered_at for velocity metrics.',
  },
  {
    name: 'estimated_value_eur',
    label: 'Estimated value (€)',
    type: 'number',
    placeholder: '50000',
  },
  {
    name: 'probability_pct',
    label: 'Probability (%)',
    type: 'number',
    placeholder: '0-100',
    help: 'Weighted value auto-computed = estimated × probability / 100',
  },
  {
    name: 'first_contact_date',
    label: 'First contact',
    type: 'date',
  },
  {
    name: 'estimated_close_date',
    label: 'Est. close',
    type: 'date',
  },
  {
    name: 'practice_areas',
    label: 'Practice areas',
    type: 'multiselect',
    options: PRACTICE_AREAS,
  },
  {
    name: 'source',
    label: 'Source',
    type: 'select',
    options: SOURCES,
  },
  {
    name: 'next_action',
    label: 'Next action',
    type: 'text',
    placeholder: 'e.g. "Send term sheet draft"',
    maxLength: 200,
  },
  {
    name: 'next_action_due',
    label: 'Next action due',
    type: 'date',
  },
  {
    name: 'loss_reason',
    label: 'Loss reason',
    type: 'select',
    options: LOSS_REASONS,
    visibleWhen: { field: 'stage', equals: 'lost' },
  },
  {
    name: 'tags',
    label: 'Tags',
    type: 'tags',
  },
  {
    name: 'notes',
    label: 'Notes',
    type: 'textarea',
  },
];

// ────────────────────────── Matter schema ─────────────────────────────

export const MATTER_FIELDS: FieldSchema[] = [
  {
    name: 'matter_reference',
    label: 'Matter reference',
    type: 'text',
    placeholder: 'Auto-generated (MP-YYYY-NNNN) if left blank',
    help: 'Usually auto-generated — only set manually for imported historic matters.',
  },
  {
    name: 'title',
    label: 'Matter title',
    type: 'text',
    required: true,
    placeholder: 'e.g. Acquisition of PortCo X — Tax & Structuring',
    maxLength: 200,
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: asOptions(MATTER_STATUSES, LABELS_MATTER_STATUS),
  },
  {
    name: 'practice_areas',
    label: 'Practice areas',
    type: 'multiselect',
    options: PRACTICE_AREAS,
  },
  {
    name: 'fee_type',
    label: 'Fee type',
    type: 'select',
    options: FEE_TYPES,
  },
  {
    name: 'hourly_rate_eur',
    label: 'Hourly rate (€)',
    type: 'number',
    visibleWhen: { field: 'fee_type', equals: 'hourly' },
  },
  {
    name: 'opening_date',
    label: 'Opening date',
    type: 'date',
  },
  {
    name: 'closing_date',
    label: 'Closing date',
    type: 'date',
  },
  {
    name: 'counterparty_name',
    label: 'Counterparty',
    type: 'text',
    placeholder: 'Primary opposing party (if any)',
    help: 'Used by the conflict check scan.',
  },
  {
    name: 'related_parties',
    label: 'Related parties',
    type: 'tags',
    help: 'Co-defendants, financing parties, etc. — all scanned for conflicts.',
  },
  {
    name: 'estimated_budget_eur',
    label: 'Estimated budget (€)',
    type: 'number',
    placeholder: '50000',
    help: 'Agreed scope budget. Triggers alert at 75 / 90 / 100 %.',
  },
  {
    name: 'cap_eur',
    label: 'Fee cap (€)',
    type: 'number',
    help: 'Hard cap above which fees require client re-approval.',
  },
  {
    name: 'conflict_check_done',
    label: 'Conflict check done?',
    type: 'checkbox',
    placeholder: 'Yes, conflicts cleared before opening this matter.',
  },
  {
    name: 'conflict_check_date',
    label: 'Conflict check date',
    type: 'date',
    visibleWhen: { field: 'conflict_check_done', equals: true },
  },
  {
    name: 'documents_link',
    label: 'Documents folder link',
    type: 'url',
    placeholder: 'SharePoint / iManage / Drive URL',
  },
  {
    name: 'tags',
    label: 'Tags',
    type: 'tags',
  },
  {
    name: 'notes',
    label: 'Notes',
    type: 'textarea',
  },
];

// ────────────────────────── Activity schema ───────────────────────────

export const ACTIVITY_FIELDS: FieldSchema[] = [
  {
    name: 'name',
    label: 'Activity name',
    type: 'text',
    required: true,
    placeholder: 'e.g. "Call with Alex re: Fund II term sheet"',
  },
  {
    name: 'activity_type',
    label: 'Type',
    type: 'select',
    required: true,
    options: asOptions(ACTIVITY_TYPES, LABELS_ACTIVITY_TYPE),
  },
  {
    name: 'activity_date',
    label: 'Date',
    type: 'date',
    required: true,
  },
  {
    name: 'duration_hours',
    label: 'Duration (hours)',
    type: 'number',
    placeholder: '1.5',
  },
  {
    name: 'billable',
    label: 'Billable',
    type: 'checkbox',
    placeholder: 'This activity counts against a matter\'s billable hours.',
  },
  {
    name: 'outcome',
    label: 'Outcome',
    type: 'textarea',
    placeholder: 'What happened? Summary of the call / meeting.',
  },
  {
    name: 'notes',
    label: 'Notes',
    type: 'textarea',
    placeholder: 'Context, prep, follow-up items.',
  },
];

// ────────────────────────── Task schema ────────────────────────────────

export const TASK_FIELDS: FieldSchema[] = [
  {
    name: 'title',
    label: 'Task',
    type: 'text',
    required: true,
    placeholder: 'e.g. "Follow up with Client X on engagement letter"',
    maxLength: 200,
  },
  {
    name: 'priority',
    label: 'Priority',
    type: 'select',
    options: asOptions(TASK_PRIORITIES, LABELS_TASK_PRIORITY),
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: asOptions(TASK_STATUSES, LABELS_TASK_STATUS),
  },
  {
    name: 'due_date',
    label: 'Due date',
    type: 'date',
  },
  {
    name: 'reminder_at',
    label: 'Reminder (optional)',
    type: 'date',
    help: 'When cifra should nudge you about this task.',
  },
  {
    name: 'description',
    label: 'Description',
    type: 'textarea',
  },
];

// ────────────────────────── Invoice schema ─────────────────────────────

export const INVOICE_FIELDS: FieldSchema[] = [
  {
    name: 'invoice_number',
    label: 'Invoice number',
    type: 'text',
    placeholder: 'Auto-generated (MP-YYYY-NNNN) if left blank',
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: asOptions(INVOICE_STATUSES, LABELS_INVOICE_STATUS),
  },
  {
    name: 'issue_date',
    label: 'Issue date',
    type: 'date',
  },
  {
    name: 'due_date',
    label: 'Due date',
    type: 'date',
  },
  {
    name: 'currency',
    label: 'Currency',
    type: 'select',
    options: [
      { value: 'EUR', label: 'EUR · Euro' },
      { value: 'GBP', label: 'GBP · British Pound' },
      { value: 'USD', label: 'USD · US Dollar' },
      { value: 'CHF', label: 'CHF · Swiss Franc' },
    ],
  },
  {
    name: 'amount_excl_vat',
    label: 'Amount (excl. VAT)',
    type: 'number',
    required: true,
    placeholder: '5000',
  },
  {
    name: 'vat_rate',
    label: 'VAT rate (%)',
    type: 'number',
    placeholder: '17',
    help: 'VAT amount auto-computed. Use 17 for LU standard, 0 for exempt / reverse charge.',
  },
  {
    name: 'amount_incl_vat',
    label: 'Amount (incl. VAT)',
    type: 'number',
    help: 'Optional — computed from excl. + VAT when left blank.',
  },
  {
    name: 'payment_method',
    label: 'Payment method',
    type: 'select',
    options: [
      { value: 'bank_transfer', label: 'Bank transfer' },
      { value: 'direct_debit',  label: 'Direct debit' },
      { value: 'other',         label: 'Other' },
    ],
  },
  {
    name: 'payment_reference',
    label: 'Payment reference',
    type: 'text',
    help: 'Client-side reference when payment arrives (matching bank statement).',
  },
  {
    name: 'notes',
    label: 'Notes',
    type: 'textarea',
  },
];
