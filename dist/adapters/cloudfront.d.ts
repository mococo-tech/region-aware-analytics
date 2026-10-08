import { type RegionPolicy, type RegionRules } from "../core.js";
export type HeaderCollection = {
    get(name: string): string | null;
} | Readonly<Record<string, string | readonly string[] | undefined>>;
export interface CloudFrontTrust {
    /** True only when the deployment guarantees a CloudFront-generated header. */
    trustedProxy: boolean;
    productionHosts: readonly string[];
}
/**
 * Use only behind a distribution that overwrites the viewer-supplied country
 * header. The trust option cannot establish that infrastructure guarantee.
 * An arbitrary public Node server must pass trustedProxy: false.
 */
export declare function classifyCloudFrontRequest(request: {
    headers: HeaderCollection;
}, rules: RegionRules, options: CloudFrontTrust): RegionPolicy;
