import type { NextConfig } from 'next';

// ════════════════════════════════════════════════════════════════════════
// Security headers — locked down for a tax-data SaaS.
//
// CSP whitelist:
// - Supabase (REST + storage + realtime websockets)
// - Anthropic API
// - ECB statistical data API (FX rates)
// - Vercel Live (preview toolbar on deploys — PREVIEW ONLY since stint 91;
//   in production we drop unsafe-inline + unsafe-eval + the vercel.live
//   hosts so a compromised dependency can't inject inline JS into a real
//   data session). See docs/SECURITY_AUDIT_2026-05-16.md §6.
// ════════════════════════════════════════════════════════════════════════

const IS_PROD = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

// Production: drop 'unsafe-eval' + Vercel Live hosts. We keep
// 'unsafe-inline' because Next.js 16 ships an inline bootstrap shim
// — switching to a nonce scheme is a real refactor (proxy + middleware
// must inject a per-request nonce). Removing 'unsafe-eval' and the
// Vercel Live origins is the biggest realistic win for the dogfood
// deployment: it eliminates dynamic code evaluation (the worst
// XSS-amplifier) and the preview-toolbar origin allowlist (irrelevant
// on the prod domain). Preview deployments keep the full set so the
// Vercel toolbar still works while reviewing PRs.
const scriptSrc = IS_PROD
  ? `script-src 'self' 'unsafe-inline'`
  : `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://va.vercel-scripts.com`;

const connectSrc = IS_PROD
  ? `connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://api.anthropic.com https://data-api.ecb.europa.eu`
  : `connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://api.anthropic.com https://data-api.ecb.europa.eu https://vercel.live https://vitals.vercel-insights.com`;

const ContentSecurityPolicy = [
  `default-src 'self'`,
  scriptSrc,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in`,
  `font-src 'self' data:`,
  connectSrc,
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

export default nextConfig;
