import { safePageURL, safeReferrer } from "./core.js";
/** This adapter owns one GA4 property. Consent UI and regional rules are separate. */
export function createGa4Provider(options) {
    if (!/^G-[A-Z0-9]+$/.test(options.measurementId))
        throw new TypeError("Use a GA4 measurement ID.");
    if (!safePageURL(options.origin, options.origin))
        throw new TypeError("Use an absolute HTTP(S) origin without a path.");
    const lifetime = options.cookieDurationSeconds ?? 180 * 86400;
    if (!Number.isSafeInteger(lifetime) || lifetime <= 0)
        throw new RangeError("Cookie lifetime must be a positive integer.");
    const win = (options.window ??
        (typeof window === "undefined" ? undefined : window));
    const id = options.measurementId;
    const key = `ga-disable-${id}`;
    const domain = new URL(options.origin).hostname;
    let enabled = false;
    let loaded = false;
    let disposed = false;
    let page = null;
    if (win)
        win[key] = true;
    function clearCookies() {
        if (!win)
            return;
        try {
            for (const name of win.document.cookie
                .split(";")
                .map((entry) => entry.trim().split("=")[0])) {
                if (name !== "_ga" && name !== `_ga_${id.slice(2)}`)
                    continue;
                for (const scope of ["", `; Domain=${domain}`, `; Domain=.${domain}`]) {
                    win.document.cookie = `${name}=; Max-Age=0; Path=/${scope}; SameSite=Lax; Secure`;
                }
            }
        }
        catch {
            /* Cookie access can be blocked; the property remains disabled. */
        }
    }
    function load() {
        if (!win || loaded || !enabled || !page || disposed)
            return;
        loaded = true;
        win.dataLayer ??= [];
        win.gtag ??= function () {
            // Google's command queue requires Arguments objects, not data-event arrays.
            win.dataLayer?.push(arguments);
        };
        win.gtag("consent", "default", {
            analytics_storage: "granted",
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied",
        });
        win.gtag("js", new Date());
        win.gtag("set", page);
        win.gtag("config", id, {
            send_page_view: false,
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
            cookie_expires: lifetime,
            cookie_update: false,
            cookie_domain: domain,
            cookie_flags: "SameSite=Lax;Secure",
        });
        const script = win.document.createElement("script");
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
        script.referrerPolicy = "origin";
        win.document.head.append(script);
    }
    return {
        /** Enabling alone makes no network request; a valid pageView starts GA4. */
        setEnabled(value, settings = {}) {
            enabled = !disposed && value === true && !!win;
            if (win)
                win[key] = !enabled;
            if (!enabled && settings.clearCookies !== false)
                clearCookies();
        },
        /** Call once per navigation, after updating the public canonical URL/title. */
        pageView(view) {
            if (!enabled || !win || disposed)
                return false;
            const url = safePageURL(view.url, options.origin);
            if (!url) {
                enabled = false;
                win[key] = true;
                page = null;
                return false;
            }
            const referrer = view.referrer ?? "";
            page = {
                page_location: url,
                page_title: view.title,
                page_referrer: safePageURL(referrer, options.origin) ?? safeReferrer(referrer),
            };
            load();
            // Global values also sanitize automatic engagement after client navigation.
            win.gtag?.("set", page);
            win.gtag?.("event", "page_view", { ...page, send_to: id });
            return true;
        },
        /** Only events with exact, enumerated parameter schemas can be sent. */
        track(name, values) {
            if (!enabled || !loaded || !page || !win || disposed)
                return false;
            const schemas = options.events ?? {};
            if (!Object.hasOwn(schemas, name))
                return false;
            const schema = schemas[name];
            if (!schema || Object.keys(values).length !== Object.keys(schema).length)
                return false;
            if (!Object.entries(values).every(([key, value]) => Object.hasOwn(schema, key) &&
                typeof value === "string" &&
                schema[key].includes(value)))
                return false;
            win.gtag?.("event", name, { ...values, send_to: id });
            return true;
        },
        /** Stops future collection; previously queued or sent vendor events cannot be retracted. */
        dispose() {
            disposed = true;
            enabled = false;
            if (win)
                win[key] = true;
            clearCookies();
        },
    };
}
