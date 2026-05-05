// Stint 67.D — /inbox is a stable alias for /aed-letters.
//
// Background: through stints 6–12 the AED-letter UI was referred to
// as the "Inbox" (it replaced the bell-icon tray on the topbar). The
// page itself ended up living at /aed-letters because that's the
// noun the URL is about, but several docs (CLAUDE.md §4 history,
// docs/PROTOCOLS.md, even the `g i` shortcut comment) still use the
// term "inbox". A 404 on /inbox is therefore a foreseeable user
// request — Diego or a reader of the docs types it expecting to land
// on the AED letters surface. Server-side redirect is the cheapest
// fix: one round-trip to /aed-letters, no broken bookmarks.

import { redirect } from 'next/navigation';

export default function InboxAlias(): never {
  redirect('/aed-letters');
}
