'use client';

// ════════════════════════════════════════════════════════════════════════
// PostHog — product analytics client.
//
// Tracks what people actually DO in cifra: declarations created,
// classifier runs, approvals, overrides, attachment analyses, etc.
// Unlike Sentry (which captures errors), PostHog captures usage —
// the signal we need to know "is the product landing, where do users
// get stuck, which features matter".
//
// Activates ONLY when NEXT_PUBLIC_POSTHOG_KEY is set. Missing key =
// complete no-op, no network calls.
//
// Region: EU (`eu.i.posthog.com`) by default to keep data in EU —
// matches Supabase's eu-central-1 region and cifra's compliance story.
// Override via NEXT_PUBLIC_POSTHOG_HOST if we ever move.
//
// Person profiles set to 'identified_only' — we don't create anonymous
// person profiles for every pageview (cheaper + more privacy-friendly).
// ════════════════════════════════════════════════════════════════════════

import posthog from 'posthog-js';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

let initialized = false;

/** Idempotent init — safe to call from multiple React effects. */
export function initPostHog(): void {
  if (initialized) return;
  if (!KEY) return;                  // no-op when unconfigured
  if (typeof window === 'undefined') return; // SSR guard

  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: 'identified_only',
    // We track pageviews manually in PostHogProvider (see below) so we
    // can use Next's client-side routing events instead of relying on
    // full page reloads.
    capture_pageview: false,
    capture_pageleave: true,
    // Don't auto-record clicks on every element — too noisy. We use
    // explicit `posthog.capture()` calls at business moments only.
    autocapture: false,
    // Respect "Do Not Track" — no capture for users who've set it.
    respect_dnt: true,
  });

  initialized = true;
}

/** Fire a named event. Cheap no-op if PostHog isn't configured. */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!KEY) return;
  if (typeof window === 'undefined') return;
  try {
    posthog.capture(event, properties);
  } catch { /* never let telemetry break the app */ }
}

/** Associate subsequent events with a known user id (e.g. after login). */
export function identify(userId: string, properties?: Record<string, unknown>): void {
  if (!KEY) return;
  if (typeof window === 'undefined') return;
  try {
    posthog.identify(userId, properties);
  } catch { /* noop */ }
}

export { posthog };
