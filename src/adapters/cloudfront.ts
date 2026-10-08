import {
  classifyCountry,
  type RegionPolicy,
  type RegionRules,
} from "../core.js";

export type HeaderCollection =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface CloudFrontTrust {
  /** True only when the deployment guarantees a CloudFront-generated header. */
  trustedProxy: boolean;
  productionHosts: readonly string[];
}

function singleHeader(headers: HeaderCollection, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name);
  }
  const matching = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === name,
  );
  if (matching.length !== 1) return null;
  const value = matching[0]?.[1];
  return typeof value === "string" ? value : null;
}

/**
 * Use only behind a distribution that overwrites the viewer-supplied country
 * header. The trust option cannot establish that infrastructure guarantee.
 * An arbitrary public Node server must pass trustedProxy: false.
 */
export function classifyCloudFrontRequest(
  request: { headers: HeaderCollection },
  rules: RegionRules,
  options: CloudFrontTrust,
): RegionPolicy {
  if (options.trustedProxy !== true) return "unknown";
  const host = singleHeader(request.headers, "host")?.toLowerCase();
  if (
    !host ||
    !options.productionHosts.some((allowed) => allowed.toLowerCase() === host)
  )
    return "unknown";
  return classifyCountry(
    singleHeader(request.headers, "cloudfront-viewer-country"),
    rules,
  );
}
