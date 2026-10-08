# Region-aware analytics

Small TypeScript modules for region-aware analytics choices, trusted edge country classification, and optional Google Analytics 4 collection. Bring your own regional policy and interface; the package includes no legal country list, consent banner, or automatic overlay.

- Keep analytics blocked while the region is unresolved, unknown, or unavailable.
- Apply explicit country lists, with an optional application-chosen fallback for other recognized countries.
- Remember explicit allow/deny choices for a caller-defined duration.
- Respect browser Global Privacy Control and Do Not Track signals.
- Keep URL queries, fragments, and external referrer paths out of GA4 page fields.
- Permit only configured event names and enumerated parameter values.

## Install

Install a reviewed commit from GitHub. Replace `COMMIT_SHA` with its full commit hash:

```sh
npm install "github:mococo-tech/region-aware-analytics#COMMIT_SHA"
```

Compiled JavaScript and TypeScript declarations are committed in `dist/`; installation does not require a TypeScript build. This is a GitHub installation path, not an announcement of an npm registry release.

## Policy is supplied by your application

```ts
import { classifyCountry, canMeasure } from "region-aware-analytics";

// Populate these arrays only after reviewing your collection and obligations.
// Empty lists intentionally enable analytics nowhere.
const rules = { noticeOnly: [], consentRequired: [] };
const region = classifyCountry(platformCountry, rules);
const permitted = canMeasure(region, savedChoice, browserPrivacyBlocked);
```

Country values are ISO 3166-1 alpha-2 codes. Matching ignores case and surrounding spaces. If a country appears in both lists, `consent-required` takes precedence.

Version 0.2 adds an optional fallback for recognized countries outside both lists:

```ts
import type { RegionRules } from "region-aware-analytics";

// Supply reviewed lists from your application's configuration.
// This configuration enables default collection for recognized countries
// except those explicitly requiring an allow choice for your use.
function createRules(
  reviewedNoticeOnlyCountries: readonly string[],
  reviewedConsentRequiredCountries: readonly string[],
): RegionRules {
  return {
    noticeOnly: reviewedNoticeOnlyCountries,
    consentRequired: reviewedConsentRequiredCountries,
    knownCountryFallback: "notice-only",
  };
}
```

Alternatively, use `knownCountryFallback: "consent-required"` to require an allow choice in other recognized countries. Omit the option to retain the previous closed-list behavior: unmatched recognized countries remain `unavailable`. Invalid runtime fallback values also produce `unavailable` for unmatched countries. The fallback accepts exactly the two strings shown; it does not normalize them.

Classification order is: validate the country, check `consentRequired`, check `noticeOnly`, then apply a valid fallback. Missing or invalid country information always remains `unknown`, even with a fallback or a saved allow choice. Both edge adapters use this same order and preserve their trust requirements.

| Region             | Meaning                                                            | Measurement without a saved choice      |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------- |
| `notice-only`      | Caller has approved default collection for this region             | Allowed                                 |
| `consent-required` | Caller requires an explicit allow choice first                     | Blocked                                 |
| `unavailable`      | Recognized country without a matching list entry or valid fallback | Blocked, even with a saved allow choice |
| `unknown`          | Missing, invalid, or unresolved country information                | Blocked, even with a saved allow choice |

A deny choice or browser privacy signal blocks collection in every region. These names express application behavior, not legal conclusions. Country alone does not establish the law that applies: your organization, audience, purposes, provider settings, and transfers also matter. Review and maintain your own policy, disclosures, and any required consent records.

In particular, choosing default collection for all recognized countries is an explicit application decision, **not a guarantee that those countries exempt your analytics from consent**. The package supplies no legal defaults or country-specific legal recommendations. A country not listed in `consentRequired` does not establish that consent is unnecessary.

Existing configurations need no migration: omitting `knownCountryFallback` preserves version 0.1 behavior. Browser choice records remain version 1; this option does not change their expiry, storage, or denial precedence.

## Browser integration

Expose a same-origin `GET /analytics-region` endpoint that returns only `{ "region": "…" }`. Its result must come from trusted server/edge information, not browser locale or a query parameter. Use the examples below to build that endpoint.

```ts
import { createConsentController } from "region-aware-analytics/browser";
import { createGa4Provider } from "region-aware-analytics/ga4";

const consent = createConsentController({
  storageKey: "site-analytics-choice-v1",
  preferenceTtlMs: 180 * 24 * 60 * 60 * 1000, // Application policy, not a legal default.
  async resolveRegion() {
    const response = await fetch("/analytics-region", {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return "unknown";
    return (await response.json()).region;
  },
});

const analytics = createGa4Provider({
  measurementId: "G-YOURID",
  origin: "https://www.example.com",
  events: {
    product_link: { product: ["product-a", "product-b"] },
  },
});

function recordPage() {
  analytics.pageView({
    url:
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ??
      "",
    title: document.title,
    referrer: document.referrer,
  });
}

let wasPermitted = false;
const unsubscribe = consent.subscribe((state) => {
  analytics.setEnabled(state.permitted, {
    // Keep a returning visitor's cookie while region lookup is still pending.
    clearCookies:
      state.privacyBlocked ||
      state.choice === "denied" ||
      (state.resolved && !state.permitted),
  });
  if (state.permitted && !wasPermitted) recordPage();
  wasPermitted = state.permitted;

  // Own your UI: show an ordinary, accessible allow/deny prompt only when
  // state.shouldAsk is true. Keep a persistent settings entry point.
  // Disable the allow action when privacyBlocked, unknown, or unavailable.
  renderAnalyticsSettings(state);
});

await consent.start();

// Wire these calls to your own equally accessible buttons.
// consent.choose("granted");
// consent.choose("denied");

// Track fixed values only. Never pass form contents, emails, or receipt IDs.
// analytics.track("product_link", { product: "product-a" });

// On application teardown:
// unsubscribe(); consent.dispose(); analytics.dispose();
```

`renderAnalyticsSettings` represents your UI code; it is not a package export. No interface is injected. Provide clear purpose/provider information, accessible allow and deny controls, and an easy way to change a choice later. An in-flow notice and a privacy/settings section can share the same controller.

Keep four responsibilities separate: the server classifies regions, the controller remembers choices and privacy signals, the provider sends permitted events, and your application presents information and controls. For `notice-only`, a persistent footer/settings entry can offer an optional stop control; if immediate notice is required for your collection, display it before loading analytics. For `consent-required`, show your allow/deny prompt only when `state.shouldAsk` is true. A prompt need not block the rest of the page. Closing an informational notice is a display preference, not a reason to call `consent.choose("granted")`. Unknown geography must stay unmeasured and must not be presented as something an allow button can override.

Your footer control can reopen the same banner or settings interface. Keep this manual open state independent of `state.shouldAsk`, which controls the automatic prompt. Opening or closing the interface must not change a choice; call `choose` only for an explicit allow or deny action. Neither a manual allow action nor a saved grant can override an unknown/unavailable region or a browser privacy block.

For SPA navigation, call `analytics.setEnabled(false, { clearCookies: false })` before changing the page, then restore permission from `consent.getState().permitted` and call `recordPage()` once after the route's canonical URL and title are ready. This temporary pause keeps the existing analytics cookie; withdrawing consent should use the default `setEnabled(false)`, which clears cookies. Do not also enable automatic history page views or call `recordPage()` again for hash-only changes. The provider does not infer your router's lifecycle.

If a path or title can contain personal information, substitute a fixed public route/title or skip that view; query removal alone cannot sanitize them. Same-origin referrers retain their path after query/fragment removal; external referrers retain only their origin. Pass an empty referrer when its path is unsuitable for collection.

## Modules and API

All modules are ESM; browser globals are used by the browser/provider integrations. The optional `window` option supports isolated browser contexts and testing.

| Module                                       | Exports                                            |
| -------------------------------------------- | -------------------------------------------------- |
| `region-aware-analytics`                     | Pure policy, saved-choice, and URL helpers         |
| `region-aware-analytics/browser`             | `createConsentController(options)`                 |
| `region-aware-analytics/ga4`                 | `createGa4Provider(options)`                       |
| `region-aware-analytics/adapters/cloudfront` | `classifyCloudFrontRequest(request, rules, trust)` |
| `region-aware-analytics/adapters/cloudflare` | `classifyCloudflareCountry(country, rules)`        |

**Core**

- `classifyCountry(country, rules)`: returns one of the four region classifications above. `RegionRules` contains `noticeOnly` and `consentRequired` arrays, plus optional `knownCountryFallback: "notice-only" | "consent-required"`.
- `readChoice(raw, now, ttlMs)`: validates serialized version-1 choice data; returns `"granted"`, `"denied"`, or `null`. Corrupt, expired, or implausibly long-lived records are ignored.
- `makeChoiceRecord(choice, now, ttlMs)`: produces `{ version: 1, choice, expiresAt }` for JSON serialization. Invalid choices/times throw.
- `canMeasure(region, choice, privacyBlocked?)`: applies the permission table above.
- `safePageURL(canonical, origin)`: returns only an absolute same-origin URL's origin/path, or `null` for invalid input. Queries and fragments are removed.
- `safeReferrer(value)`: returns only an HTTP(S) origin with a trailing slash, or an empty string.

**Consent controller**

`createConsentController({ storageKey, preferenceTtlMs, resolveRegion, window? })` returns `start()`, `choose(choice)`, `getState()`, `subscribe(listener)`, and `dispose()`. A subscription returns an unsubscribe function. State contains:

```ts
interface ConsentState {
  readonly region:
    | "notice-only"
    | "consent-required"
    | "unavailable"
    | "unknown";
  readonly choice: "granted" | "denied" | null;
  readonly resolved: boolean;
  readonly permitted: boolean;
  readonly shouldAsk: boolean;
  readonly privacyBlocked: boolean;
}
```

`choice` is `"granted"`, `"denied"`, or `null`. Subscribe before starting. Region resolution failures remain blocked. Browser preferences override stored permission. Choices are stored locally and changes from other tabs are observed; this local record is not a server-side consent audit log.

**GA4 provider**

`createGa4Provider({ measurementId, origin, events?, cookieDurationSeconds?, window? })` returns `setEnabled(boolean, { clearCookies? }?)`, `pageView({ url, title, referrer? })`, `track(name, params)`, and `dispose()`. Enabling alone makes no network request; the first valid `pageView` loads the Google tag. Page views are explicit and their URLs are sanitized. An invalid or cross-origin canonical URL disables the provider until explicitly re-enabled. Each custom event schema maps parameter names to allowed string values; missing/extra parameters and unlisted values are rejected. `pageView` and `track` return whether the event was accepted.

Initialize this integration once per application and only on reviewed public production hosts. Your application should exclude preview environments and private or `noindex` pages. Its permission gate is separate from any other tracker or Google tag installed by your site. Google tags and consent state share browser globals; multiple properties, Tag Manager containers, or independently installed tags can interfere with these settings and need their own coordination.

## Trusted country endpoints

- [CloudFront + Node example](examples/cloudfront.mjs): forwards the generated country header to your origin and checks exact production hosts. Pass `trustedProxy: true` **only after** preventing direct-origin bypass and ensuring the edge-generated header cannot be replaced by a viewer. A boolean or matching `Host` header cannot create that infrastructure guarantee.
- [Cloudflare Worker example](examples/cloudflare.mjs): reads platform-provided `request.cf.country` and checks production hosts. It deliberately does not trust a public `CF-IPCountry` header.

Both examples start closed, accept only `GET`, and return `Cache-Control: private, no-store, max-age=0`. Disable CDN caching for the endpoint as well; never share one visitor's regional result with another. Preserve this rule in service workers. Do not put country results in a globally cached HTML response unless your cache varies correctly by region.

Pass the same reviewed `rules` object, including `knownCountryFallback` when intentionally enabled, to either example factory. A fallback never makes a preview host, untrusted proxy, missing platform country, or viewer-supplied country header trustworthy.

The library does not collect or geolocate IP addresses, persist country codes, or send them to the browser. Your CDN still processes the request and may log network metadata; your analytics provider also has its own collection behavior. IP-derived country is approximate and can change with a VPN or travel.

## GA4 configuration and withdrawal limits

Before deployment, review the GA4 property's data collection settings. Disable Enhanced Measurement features, including automatic history page views and form interactions, when using these explicit events. Disable Google signals, advertising personalization, and unwanted advertising/data-sharing connections. Existing tags or administration settings must not introduce collection outside this integration.

This provider uses basic blocking: it does not intentionally load the tag or send advanced Consent Mode cookieless pings while disabled. Disabling blocks future collection through this provider and removes its GA cookies where browser access permits. It cannot retract data already sent, guarantee cancellation of events already queued inside Google's script, remove an already loaded script from memory, or control other trackers. Validate the final site with its actual tags and consent UI.

## Development

```sh
npm install
npm test
npm run format:check
npm pack --dry-run
```

`npm test` builds the package before running tests; `npm run build` is also available on its own. Commit regenerated `dist/` when changing source so pinned GitHub installations stay usable. CI checks formatting, tests, and whether the build output matches the committed files.

See [CHANGELOG.md](CHANGELOG.md) for compatibility and release changes.

## License

[MIT](LICENSE), copyright 2026 MococoTECH.
