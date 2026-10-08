import { type RegionPolicy, type RegionRules } from "../core.js";
/**
 * Pass the incoming Worker request's platform-provided request.cf.country.
 * Do not pass a public request header, URL parameter, or browser-derived value.
 * This helper deliberately does not inspect CF-IPCountry headers.
 */
export declare function classifyCloudflareCountry(country: unknown, rules: RegionRules): RegionPolicy;
