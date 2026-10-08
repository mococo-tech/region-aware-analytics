/** Runtime classifications, not a built-in interpretation of any country's law. */
export type RegionPolicy = "notice-only" | "consent-required" | "unavailable" | "unknown";
export type Choice = "granted" | "denied";
export interface RegionRules {
    noticeOnly: readonly string[];
    consentRequired: readonly string[];
    /** Explicit application policy for recognized countries absent from both lists. */
    knownCountryFallback?: "notice-only" | "consent-required";
}
export interface ChoiceRecord {
    version: 1;
    choice: Choice;
    expiresAt: number;
}
/** Explicit lists precede an optional fallback; unknown geography stays blocked. */
export declare function classifyCountry(country: unknown, rules: RegionRules): RegionPolicy;
/** Invalid, expired, or implausibly long-lived choices never imply consent. */
export declare function readChoice(raw: string | null, now: number, ttlMs: number): Choice | null;
/** Returns an object for JSON serialization by the caller's storage adapter. */
export declare function makeChoiceRecord(choice: Choice, now: number, ttlMs: number): ChoiceRecord;
export declare function canMeasure(region: RegionPolicy, choice: Choice | null, privacyBlocked?: boolean): boolean;
/** Only an absolute, same-origin canonical URL's origin and path may be sent. */
export declare function safePageURL(canonical: string | null, origin: string): string | null;
/** Referrers retain their HTTP(S) origin only, never paths or query values. */
export declare function safeReferrer(value: string): string;
