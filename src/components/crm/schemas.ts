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
