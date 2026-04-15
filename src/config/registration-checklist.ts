// Registration document checklist per PRD §14.2 Phase 2.
// Each item knows which regime requires it ('all' | 'ordinary' | 'simplified').
// The platform shows a default checklist that the user can customise per registration.

export type ChecklistItem = {
  key: string;
  label: string;
  description: string;
  required_for: 'all' | 'ordinary' | 'simplified';
  done?: boolean;
  received_at?: string | null;
  notes?: string | null;
};

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  {
    key: 'articles_of_association',
    label: 'Articles of association',
    description: 'Constitutional documents filed with RCS.',
    required_for: 'all',
  },
  {
    key: 'manager_passports',
    label: 'Manager / director passports',
    description: 'Certified true copies of all signing managers.',
    required_for: 'all',
  },
  {
    key: 'lease_or_domiciliation',
    label: 'Lease or domiciliation agreement',
    description: 'Executed version showing the registered office address.',
    required_for: 'all',
  },
  {
    key: 'power_of_attorney',
    label: 'Power of Attorney',
    description: 'Signed by authorised signatories (typically Class A + Class B). Expires after 3 months.',
    required_for: 'all',
  },
  {
    key: 'bank_iban',
    label: 'Bank account details (IBAN + BIC)',
    description: 'Required for AED form field 9.',
    required_for: 'all',
  },
  {
    key: 'msa',
    label: 'Management Services Agreement',
    description: 'Justifies the VAT-able activity. Required only for ordinary regime.',
    required_for: 'ordinary',
  },
  {
    key: 'business_permit',
    label: 'Business permit / licence',
    description: 'Only if the activity requires regulatory authorisation.',
    required_for: 'all',
  },
];

export function defaultChecklistForRegime(regime: 'simplified' | 'ordinary'): ChecklistItem[] {
  return DEFAULT_CHECKLIST.filter(item =>
    item.required_for === 'all' || item.required_for === regime
  ).map(item => ({ ...item, done: false, received_at: null, notes: null }));
}
