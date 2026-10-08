# Changelog

## 0.2.0 — 2026-10-09

- Add optional `RegionRules.knownCountryFallback`, accepting `"notice-only"` or `"consent-required"` for recognized countries absent from both explicit lists.
- Keep explicit consent-required rules ahead of notice-only rules and any fallback. Missing, invalid, or untrusted country information remains `unknown` and cannot be overridden by a saved allow choice.
- Preserve version 0.1 behavior when the option is omitted. Invalid runtime fallback values also leave unmatched recognized countries `unavailable`.
- Apply the same policy through both CloudFront and Cloudflare adapters without changing their trust checks.
- Document the separation of country policy, browser preferences, analytics providers, and site-owned notices/settings. No legal country list, legal exemption, or automatic interface is included.
- Add fallback, precedence, unknown-country, and adapter trust regression coverage; regenerate the committed JavaScript and TypeScript declarations.

The browser controller, GA4 provider, exports, and version-1 saved-choice format are unchanged. Existing configurations do not require migration.

## 0.1.0

- Initial modular policy helpers, browser consent controller, GA4 provider, and trusted CloudFront/Cloudflare adapters.
- Explicit reviewed country lists, caller-defined choice expiry, browser privacy signal handling, and sanitized page/referrer fields.
- A temporary provider pause can preserve existing cookies while the region is unresolved or a page transition is in progress.
