export interface Ga4Options {
    measurementId: string;
    origin: string;
    events?: Record<string, Record<string, readonly string[]>>;
    cookieDurationSeconds?: number;
    window?: Window;
}
export interface PageView {
    /** An absolute, public canonical URL. Paths and titles must not contain personal data. */
    url: string;
    title: string;
    referrer?: string;
}
/** This adapter owns one GA4 property. Consent UI and regional rules are separate. */
export declare function createGa4Provider(options: Ga4Options): {
    /** Enabling alone makes no network request; a valid pageView starts GA4. */
    setEnabled(value: boolean, settings?: {
        clearCookies?: boolean;
    }): void;
    /** Call once per navigation, after updating the public canonical URL/title. */
    pageView(view: PageView): boolean;
    /** Only events with exact, enumerated parameter schemas can be sent. */
    track(name: string, values: Record<string, string>): boolean;
    /** Stops future collection; previously queued or sent vendor events cannot be retracted. */
    dispose(): void;
};
