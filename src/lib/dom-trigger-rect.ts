// dom-trigger-rect — helper for hover-preview / popover positioning.
//
// The hover-preview components in this codebase wrap their `{children}`
// in a `<span ref={triggerRef} className="contents">` so the wrapper
// doesn't disturb the layout of its parent (a table cell, a flex row,
// etc.). CSS `display: contents` makes the wrapper layout-invisible —
// its descendants render as direct children of the parent.
//
// Side effect: `element.getBoundingClientRect()` on a `display:contents`
// element returns `{0,0,0,0}`. If the popover code feeds that rect into
// its position calculation, the popover ends up at `(top: 6, left: 8)`
// — the top-left corner of the viewport, hidden behind any sticky nav.
//
// Stint 98 — fix found while Diego was using /crm/opportunities. Bug
// was latent in all 4 CRM hover-preview components since stint 63.L
// (Opportunity, Company, Contact, Matter). Helper walks first-children
// until it finds an element with a real layout box.

export function getTriggerRect(
  el: Element | null | undefined,
): DOMRect | null {
  if (!el) return null;
  let cur: Element | null = el;
  while (cur) {
    const rect = cur.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
    cur = cur.firstElementChild;
  }
  return null;
}
