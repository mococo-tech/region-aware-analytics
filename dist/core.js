const countryCodes = new Set(("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
    "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" "));
/** The caller supplies reviewed rules; no country is enabled by default. */
export function classifyCountry(country, rules) {
    if (typeof country !== "string")
        return "unknown";
    const code = country.trim().toUpperCase();
    if (!countryCodes.has(code))
        return "unknown";
    const matches = (entry) => entry.trim().toUpperCase() === code;
    // A duplicate in both lists never allows a consent-required visitor by default.
    if (rules.consentRequired.some(matches))
        return "consent-required";
    if (rules.noticeOnly.some(matches))
        return "notice-only";
    return "unavailable";
}
function validTimeRange(now, ttlMs) {
    return (Number.isSafeInteger(now) &&
        now >= 0 &&
        Number.isSafeInteger(ttlMs) &&
        ttlMs > 0 &&
        Number.isSafeInteger(now + ttlMs));
}
/** Invalid, expired, or implausibly long-lived choices never imply consent. */
export function readChoice(raw, now, ttlMs) {
    if (!validTimeRange(now, ttlMs))
        return null;
    try {
        const record = JSON.parse(raw ?? "null");
        if (typeof record !== "object" || record === null)
            return null;
        const saved = record;
        if (saved.version === 1 &&
            (saved.choice === "granted" || saved.choice === "denied") &&
            typeof saved.expiresAt === "number" &&
            Number.isSafeInteger(saved.expiresAt) &&
            saved.expiresAt > now &&
            saved.expiresAt <= now + ttlMs) {
            return saved.choice;
        }
    }
    catch {
        // Corrupt or unavailable browser storage is equivalent to no saved choice.
    }
    return null;
}
/** Returns an object for JSON serialization by the caller's storage adapter. */
export function makeChoiceRecord(choice, now, ttlMs) {
    if (choice !== "granted" && choice !== "denied") {
        throw new TypeError("Choice must be granted or denied.");
    }
    if (!validTimeRange(now, ttlMs)) {
        throw new RangeError("Use a non-negative timestamp and a positive finite TTL in milliseconds.");
    }
    return { version: 1, choice, expiresAt: now + ttlMs };
}
export function canMeasure(region, choice, privacyBlocked = false) {
    if (privacyBlocked || choice === "denied")
        return false;
    return (region === "notice-only" ||
        (region === "consent-required" && choice === "granted"));
}
/** Only an absolute, same-origin canonical URL's origin and path may be sent. */
export function safePageURL(canonical, origin) {
    try {
        const expected = new URL(origin);
        const page = new URL(canonical ?? "");
        if (!["http:", "https:"].includes(expected.protocol) ||
            expected.pathname !== "/" ||
            expected.search ||
            expected.hash ||
            expected.username ||
            expected.password ||
            page.origin !== expected.origin)
            return null;
        return page.origin + page.pathname;
    }
    catch {
        return null;
    }
}
/** Referrers retain their HTTP(S) origin only, never paths or query values. */
export function safeReferrer(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.origin + "/" : "";
    }
    catch {
        return "";
    }
}
