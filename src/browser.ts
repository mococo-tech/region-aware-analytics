import {
  canMeasure,
  makeChoiceRecord,
  readChoice,
  type Choice,
  type ChoiceRecord,
  type RegionPolicy,
} from "./core.js";

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

const MAX_TIMER_DELAY = 2_147_483_647;
const policies: readonly RegionPolicy[] = [
  "notice-only",
  "consent-required",
  "unavailable",
  "unknown",
];

/**
 * Manages permission only: the caller owns notices, regional rules and analytics.
 * Browser storage is best effort; its in-memory fallback has the same expiry.
 * Server-side instances remain unknown and never grant measurement permission.
 */
export function createConsentController(
  options: ConsentControllerOptions,
): ConsentController {
  if (!options.storageKey.trim()) {
    throw new TypeError("A non-empty storage key is required.");
  }
  // Validate the TTL before accessing browser storage or starting any timers.
  makeChoiceRecord("denied", Date.now(), options.preferenceTtlMs);

  const browser =
    options.window ?? (typeof window === "undefined" ? undefined : window);
  const listeners = new Set<(state: ConsentState) => void>();
  let rawChoice: string | null = null;
  let region: RegionPolicy = "unknown";
  let resolved = false;
  let disposed = false;
  let expiryTimer: number | undefined;
  let startPromise: Promise<void> | undefined;

  try {
    rawChoice = browser?.localStorage.getItem(options.storageKey) ?? null;
  } catch {
    // Storage access can be blocked even when the browser itself is available.
  }

  function snapshot(): ConsentState {
    const choice = readChoice(rawChoice, Date.now(), options.preferenceTtlMs);
    const navigator = browser?.navigator as
      | (Navigator & { globalPrivacyControl?: boolean })
      | undefined;
    const privacyBlocked =
      navigator?.globalPrivacyControl === true || navigator?.doNotTrack === "1";
    return Object.freeze({
      region,
      choice,
      resolved,
      privacyBlocked,
      permitted:
        !disposed &&
        browser !== undefined &&
        resolved &&
        canMeasure(region, choice, privacyBlocked),
      shouldAsk:
        !disposed &&
        browser !== undefined &&
        resolved &&
        region === "consent-required" &&
        choice === null &&
        !privacyBlocked,
    });
  }

  let state = snapshot();

  function scheduleExpiry() {
    if (expiryTimer !== undefined) browser?.clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (disposed || !browser || state.choice === null) return;

    // A non-null choice means readChoice already validated this record.
    const saved = JSON.parse(rawChoice!) as ChoiceRecord;
    const delay = Math.min(
      MAX_TIMER_DELAY,
      Math.max(1, saved.expiresAt - Date.now()),
    );
    expiryTimer = browser.setTimeout(refresh, delay);
  }

  function refresh() {
    if (disposed) return;
    const next = snapshot();
    const changed =
      state.region !== next.region ||
      state.choice !== next.choice ||
      state.resolved !== next.resolved ||
      state.permitted !== next.permitted ||
      state.shouldAsk !== next.shouldAsk ||
      state.privacyBlocked !== next.privacyBlocked;
    state = next;
    scheduleExpiry();
    if (changed) {
      // Copy the set so subscribing during a notification does not emit twice.
      for (const listener of [...listeners]) {
        if (disposed) break;
        if (listeners.has(listener)) listener(state);
      }
    }
  }

  function onStorage(event: StorageEvent) {
    if (disposed || (event.key !== options.storageKey && event.key !== null)) {
      return;
    }
    try {
      if (event.storageArea && event.storageArea !== browser?.localStorage) {
        return;
      }
    } catch {
      // The event still supplies the new value when the storage getter is blocked.
    }
    rawChoice = event.key === null ? null : event.newValue;
    refresh();
  }

  browser?.addEventListener("storage", onStorage);
  // Browser privacy preferences can change while this tab is in the background.
  browser?.addEventListener("focus", refresh);
  browser?.addEventListener("pageshow", refresh);
  scheduleExpiry();

  return {
    start() {
      if (disposed) return Promise.resolve();
      if (!startPromise) {
        startPromise = Promise.resolve()
          .then(() => {
            if (disposed || !browser) return "unknown" as const;
            return options.resolveRegion();
          })
          .catch(() => "unknown" as const)
          .then((result) => {
            if (disposed) return;
            region = policies.includes(result) ? result : "unknown";
            resolved = true;
            refresh();
          });
        refresh();
      }
      return startPromise;
    },
    choose(choice) {
      if (disposed) return;
      const record = makeChoiceRecord(
        choice,
        Date.now(),
        options.preferenceTtlMs,
      );
      rawChoice = JSON.stringify(record);
      try {
        browser?.localStorage.setItem(options.storageKey, rawChoice);
      } catch {
        // Keep the record (including its expiry), never an unbounded preference.
      }
      refresh();
    },
    getState() {
      return snapshot();
    },
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (expiryTimer !== undefined) browser?.clearTimeout(expiryTimer);
      expiryTimer = undefined;
      browser?.removeEventListener("storage", onStorage);
      browser?.removeEventListener("focus", refresh);
      browser?.removeEventListener("pageshow", refresh);
      listeners.clear();
    },
  };
}
