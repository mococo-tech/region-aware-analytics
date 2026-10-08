import { classifyCloudFrontRequest } from "region-aware-analytics/adapters/cloudfront";

/**
 * Node HTTP handler for an origin behind CloudFront.
 *
 * Supply your reviewed region rules and exact public host names. Set
 * trustedProxy only when your infrastructure prevents direct-origin bypass
 * and supplies a CloudFront-generated CloudFront-Viewer-Country header.
 * Host matching alone does not establish trust. Never derive this option
 * from an incoming request header, query parameter, or browser value.
 *
 * Configure the /analytics-region behavior to forward the generated country
 * header and disable caching. A no-store response alone does not override a
 * CloudFront cache policy with a positive minimum TTL.
 */
export function createRegionHandler({
  rules = { noticeOnly: [], consentRequired: [] },
  productionHosts = [],
  trustedProxy = false,
} = {}) {
  return function regionHandler(request, response) {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    };
    const pathname = request.url?.split("?")[0];
    if (pathname !== "/analytics-region") {
      response.writeHead(404, headers);
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { ...headers, Allow: "GET" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    const region = classifyCloudFrontRequest(request, rules, {
      productionHosts,
      trustedProxy,
    });
    response.writeHead(200, headers);
    response.end(JSON.stringify({ region }));
  };
}
