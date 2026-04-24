// /tax-ops/vat — redirect to the annual sub-view by default.
// Tabs live on each sub-page so deep-links survive.

import { redirect } from 'next/navigation';

export default function VatIndexPage() {
  redirect('/tax-ops/vat/annual');
}
