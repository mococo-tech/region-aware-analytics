import { classifyCloudflareCountry } from "region-aware-analytics/adapters/cloudflare";

/**
 * Worker example. Supply reviewed country rules and exact production hosts.
 * Read only Cloudflare's platform-provided request.cf.country; do not replace
 * it with CF-IPCountry or another client-supplied header on a public origin.
 * Do not cache this endpoint in Cloudflare Cache Rules or a service worker.
 * rules accepts the same optional knownCountryFallback as the core module.
 * Set it only as an explicit reviewed policy; the empty default stays closed.
 * Invalid or missing request.cf.country remains unknown regardless of fallback.
 */
export function createRegionWorker({
  rules = { noticeOnly: [], consentRequired: [] },
  productionHosts = [],
} = {}) {
  return {
    fetch(request) {
      const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      };
      const url = new URL(request.url);
      if (url.pathname !== "/analytics-region") {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers,
        });
      }
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: { ...headers, Allow: "GET" },
        });
      }

      const allowedHost = productionHosts.some(
        (host) => host.toLowerCase() === url.host.toLowerCase(),
      );
      const region =
        url.protocol === "https:" && allowedHost
          ? classifyCloudflareCountry(request.cf?.country, rules)
          : "unknown";
      return new Response(JSON.stringify({ region }), { headers });
    },
  };
}

// Fail closed until the deployer supplies reviewed rules and production hosts.
export default createRegionWorker();
