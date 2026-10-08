import { classifyCountry, } from "../core.js";
function singleHeader(headers, name) {
    if (!headers || typeof headers !== "object")
        return null;
    if ("get" in headers && typeof headers.get === "function") {
        return headers.get(name);
    }
    const matching = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
    if (matching.length !== 1)
        return null;
    const value = matching[0]?.[1];
    return typeof value === "string" ? value : null;
}
/**
 * Use only behind a distribution that overwrites the viewer-supplied country
 * header. The trust option cannot establish that infrastructure guarantee.
 * An arbitrary public Node server must pass trustedProxy: false.
 */
export function classifyCloudFrontRequest(request, rules, options) {
    if (options.trustedProxy !== true)
        return "unknown";
    const host = singleHeader(request.headers, "host")?.toLowerCase();
    if (!host ||
        !options.productionHosts.some((allowed) => allowed.toLowerCase() === host))
        return "unknown";
    return classifyCountry(singleHeader(request.headers, "cloudfront-viewer-country"), rules);
}
