import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// ════════════════════════════════════════════════════════════════════════
// Security headers — locked down for a tax-data SaaS.
//
// We ship these on every response (both page routes and API routes)
// to get: HSTS, CSP, no framing, no MIME sniffing, strict referrer
// policy, and a Permissions-Policy that denies sensors we never use.
//
// CSP design notes:
// - 'unsafe-inline' on style-src: Next.js injects small inline styles
//   for hydration / route preloading. Required.
// - 'unsafe-inline' 'unsafe-eval' on script-src: Next.js dev overlay
//   and React hydration use inline scripts; 'unsafe-eval' is needed
//   by some Next internals under Turbopack. Revisit when Next.js
//   ships a stricter strict-dynamic compatible build.
// - connect-src whitelists every external we actually call:
//   Supabase (REST + storage + realtime websockets),
//   Anthropic API,
//   ECB statistical data API (for FX rates),
//   Vercel Live (preview toolbar on deploy previews).
// - img-src allows data: + blob: for PDF thumbnails + exceljs images,
//   plus Supabase storage.
// - frame-ancestors 'none' is the modern equivalent of X-Frame-Options
//   DENY — combined with the legacy header for maximum compatibility.
// ════════════════════════════════════════════════════════════════════════

const ContentSecurityPolicy = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://va.vercel-scripts.com https://eu-assets.i.posthog.com https://us-assets.i.posthog.com`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://*.i.posthog.com`,
  `font-src 'self' data:`,
  // connect-src: every external we POST/GET to. Added 2026-04-19:
  //   - *.sentry.io / *.ingest.sentry.io — error + perf ingest
  //   - *.i.posthog.com                   — product analytics + feature flags
  `connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://api.anthropic.com https://data-api.ecb.europa.eu https://vercel.live https://vitals.vercel-insights.com https://*.ingest.sentry.io https://*.sentry.io https://*.i.posthog.com`,
  `frame-ancestors 'none'`,
  `frame-src 'self' https://*.supabase.co`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `upgrade-insecure-requests`,
].join('; ');

const securityHeaders = [
  // HSTS: browsers remember to always use HTTPS for 2 years, and
  // the site can be preloaded into the browser HSTS preload list.
  { key: 'Strict-Transport-Security',  value: 'max-age=63072000; includeSubDomains; preload' },
  // Content Security Policy — see composition above.
  { key: 'Content-Security-Policy',    value: ContentSecurityPolicy },
  // Legacy X-Frame-Options for older browsers (frame-ancestors is the
  // modern replacement and is in CSP above).
  { key: 'X-Frame-Options',            value: 'DENY' },
  // Prevent MIME-sniffing of response content.
  { key: 'X-Content-Type-Options',     value: 'nosniff' },
  // Referrer policy: send full referrer to same-origin, origin-only
  // cross-origin, nothing cross-scheme.
  { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
  // Explicitly deny access to browser sensors we never use. Reduces
  // attack surface if a third-party script were ever injected.
  { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()' },
  // Cross-Origin-Opener-Policy: isolate the window from opener frames,
  // mitigates Spectre-class attacks against sensitive tax data.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to every route, including API.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

// ════════════════════════════════════════════════════════════════════════
// Sentry wrap.
//
// withSentryConfig uploads source maps at build time (makes stack
// traces in Sentry point to the original source) and injects a
// tunnel route so ad-blockers don't swallow error reports.
//
// If SENTRY_AUTH_TOKEN is absent (local dev, unconfigured deploys),
// the wrapper downgrades to a no-op shim — no uploads, no build
// errors. Safe to ship without the env var; errors still go to
// Sentry if NEXT_PUBLIC_SENTRY_DSN is set, just without source maps.
// ════════════════════════════════════════════════════════════════════════

export default withSentryConfig(nextConfig, {
  // Silences build log spam.
  silent: true,

  // Org + project only used for source-map upload. Absent = skip upload.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Tunnel through our own domain so ad-blockers don't swallow
  // reports. Requires Next 15+; doesn't break if Sentry is off.
  tunnelRoute: '/monitoring',

  // Strip the Sentry SDK logger from client bundles in prod.
  disableLogger: true,

  // Upload sourcemaps only if we have an auth token. Stops the build
  // from failing with a warning on deployments that don't have one.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
