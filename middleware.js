// middleware.js — Vercel Edge Middleware
// Adds baseline browser security headers to every page response (VQ-009,
// 2026-07-22 security audit — see CLAUDE.md). Scoped away from /api/* via
// the matcher below; those already set their own CORS headers per function.
//
// CSP ships in Report-Only mode, not enforcing. This app relies on inline
// onclick=/onchange= handlers and inline style= attributes throughout (a
// long-standing, pervasive pattern — see CLAUDE.md), and loads Google Tag
// Manager, which can inject third-party scripts (PostHog, GA) whose exact
// origins aren't fully knowable from static source alone. Report-Only
// surfaces violations in the browser console without blocking anything, so
// this deploy cannot break the app. Flip CSP_ENFORCE to true only after
// confirming a real browsing session shows no unexpected console
// violations — clickjacking protection (frame-ancestors) and the other
// headers below are unconditional and safe today regardless.
import { next } from '@vercel/edge';

const CSP_ENFORCE = false;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://yixrwyfodipfcbhjcszp.supabase.co https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.posthog.com https://*.i.posthog.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
].join('; ');

export const config = {
  matcher: '/((?!api/).*)'
};

export default function middleware(request) {
  const response = next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()');
  response.headers.set(CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', CSP);
  return response;
}
