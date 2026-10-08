import { type Choice, type RegionPolicy } from "./core.js";
export interface ConsentState {
    readonly region: RegionPolicy;
    readonly choice: Choice | null;
    readonly resolved: boolean;
    readonly permitted: boolean;
    readonly shouldAsk: boolean;
    readonly privacyBlocked: boolean;
}
export interface ConsentControllerOptions {
    storageKey: string;
    preferenceTtlMs: number;
    resolveRegion: () => Promise<RegionPolicy>;
    window?: Window;
}
export interface ConsentController {
    start(): Promise<void>;
    choose(choice: Choice): void;
    getState(): ConsentState;
    subscribe(listener: (state: ConsentState) => void): () => void;
    dispose(): void;
}
/**
 * Manages permission only: the caller owns notices, regional rules and analytics.
 * Browser storage is best effort; its in-memory fallback has the same expiry.
 * Server-side instances remain unknown and never grant measurement permission.
 */
export declare function createConsentController(options: ConsentControllerOptions): ConsentController;
