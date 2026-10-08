import assert from "node:assert/strict";
import test from "node:test";
import { createConsentController } from "../dist/browser.js";

const key = "test-analytics-choice";

class MemoryStorage {
  values = new Map();
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, value);
  }
  removeItem(key) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

class FakeWindow extends EventTarget {
  navigator = { doNotTrack: "0", globalPrivacyControl: false };
  localStorage = new MemoryStorage();
  timers = new Map();
  nextTimer = 0;
  now = 1_000;
  setTimeout = (callback, delay) => {
    const id = ++this.nextTimer;
    this.timers.set(id, { callback, delay, due: this.now + delay });
    return id;
  };
  clearTimeout = (id) => this.timers.delete(id);
  advance(ms) {
    this.now += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.due <= this.now) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
  storageEvent(key, newValue, storageArea = this.localStorage) {
    const event = new Event("storage");
    Object.defineProperties(event, {
      key: { value: key },
      newValue: { value: newValue },
      storageArea: { value: storageArea },
    });
    this.dispatchEvent(event);
  }
}

function setup(t, region = "consent-required", ttl = 100) {
  const browser = new FakeWindow();
  t.mock.method(Date, "now", () => browser.now);
  const controller = createConsentController({
    storageKey: key,
    preferenceTtlMs: ttl,
    resolveRegion: async () => region,
    window: browser,
  });
  t.after(() => controller.dispose());
  return { browser, controller };
}

function raw(choice, expiresAt = 1_100) {
  return JSON.stringify({ version: 1, choice, expiresAt });
}

test("starts once, emits immediately, and uses explicit consent", async (t) => {
  const browser = new FakeWindow();
  t.mock.method(Date, "now", () => browser.now);
  let calls = 0;
  const controller = createConsentController({
    storageKey: key,
    preferenceTtlMs: 100,
    resolveRegion: async () => {
      calls += 1;
      return "consent-required";
    },
    window: browser,
  });
  t.after(() => controller.dispose());
  const states = [];
  const unsubscribe = controller.subscribe((state) => states.push(state));
  assert.equal(states.length, 1);
  assert.equal(states[0].resolved, false);
  assert.equal(Object.isFrozen(states[0]), true);
  const first = controller.start();
  assert.equal(first, controller.start());
  await first;
  assert.equal(calls, 1);
  assert.equal(controller.getState().shouldAsk, true);
  assert.equal(controller.getState().permitted, false);
  controller.choose("granted");
  assert.equal(controller.getState().permitted, true);
  assert.equal(controller.getState().shouldAsk, false);
  assert.deepEqual(JSON.parse(browser.localStorage.getItem(key)), {
    version: 1,
    choice: "granted",
    expiresAt: 1_100,
  });
  controller.choose("denied");
  assert.equal(controller.getState().permitted, false);
  const count = states.length;
  unsubscribe();
  controller.choose("granted");
  assert.equal(states.length, count);
});

test("notice-only permits without a saved choice but honors denial", async (t) => {
  const { controller } = setup(t, "notice-only");
  assert.equal(controller.getState().permitted, false);
  await controller.start();
  assert.equal(controller.getState().permitted, true);
  assert.equal(controller.getState().shouldAsk, false);
  controller.choose("denied");
  assert.equal(controller.getState().permitted, false);
});

test("unknown, unavailable and resolution failure block stored grants", async (t) => {
  const browser = new FakeWindow();
  t.mock.method(Date, "now", () => browser.now);
  browser.localStorage.setItem(key, raw("granted"));
  for (const resolveRegion of [
    async () => "unknown",
    async () => "unavailable",
    async () => {
      throw new Error("offline");
    },
    () => {
      throw new Error("synchronous failure");
    },
    async () => "not-a-policy",
  ]) {
    const controller = createConsentController({
      storageKey: key,
      preferenceTtlMs: 100,
      resolveRegion,
      window: browser,
    });
    await controller.start();
    assert.equal(controller.getState().choice, "granted");
    assert.equal(controller.getState().permitted, false);
    assert.equal(controller.getState().shouldAsk, false);
    assert.equal(controller.getState().resolved, true);
    controller.dispose();
  }
});

test("GPC and DNT override grants, and suppress consent prompts", async (t) => {
  const { browser, controller } = setup(t);
  await controller.start();
  browser.navigator.globalPrivacyControl = true;
  browser.dispatchEvent(new Event("focus"));
  assert.equal(controller.getState().shouldAsk, false);
  controller.choose("granted");
  assert.equal(controller.getState().choice, "granted");
  assert.equal(controller.getState().privacyBlocked, true);
  assert.equal(controller.getState().permitted, false);
  browser.navigator.globalPrivacyControl = false;
  browser.navigator.doNotTrack = "1";
  browser.dispatchEvent(new Event("pageshow"));
  assert.equal(controller.getState().permitted, false);
  browser.navigator.doNotTrack = "0";
  browser.dispatchEvent(new Event("focus"));
  assert.equal(controller.getState().permitted, true);
});

test("storage failures retain a memory choice with the same expiry", async (t) => {
  const browser = new FakeWindow();
  t.mock.method(Date, "now", () => browser.now);
  Object.defineProperty(browser, "localStorage", {
    get() {
      throw new Error("blocked storage");
    },
  });
  const controller = createConsentController({
    storageKey: key,
    preferenceTtlMs: 100,
    resolveRegion: async () => "consent-required",
    window: browser,
  });
  t.after(() => controller.dispose());
  await controller.start();
  controller.choose("granted");
  assert.equal(controller.getState().permitted, true);
  browser.advance(99);
  assert.equal(controller.getState().permitted, true);
  browser.advance(1);
  assert.equal(controller.getState().choice, null);
  assert.equal(controller.getState().permitted, false);
  assert.equal(controller.getState().shouldAsk, true);
  assert.equal(browser.timers.size, 0);
});

test("failed writes do not resurrect an older saved grant", async (t) => {
  const { browser, controller } = setup(t);
  await controller.start();
  controller.choose("granted");
  browser.localStorage.setItem = () => {
    throw new Error("quota");
  };
  controller.choose("denied");
  browser.dispatchEvent(new Event("focus"));
  assert.equal(controller.getState().choice, "denied");
  assert.equal(controller.getState().permitted, false);
  assert.equal(JSON.parse(browser.localStorage.getItem(key)).choice, "granted");
});

test("cross-tab preference and clear events update permission", async (t) => {
  const { browser, controller } = setup(t);
  await controller.start();
  browser.storageEvent(key, raw("granted"));
  assert.equal(controller.getState().permitted, true);
  browser.storageEvent("unrelated", raw("denied"));
  assert.equal(controller.getState().permitted, true);
  browser.storageEvent(key, raw("denied"), new MemoryStorage());
  assert.equal(controller.getState().permitted, true);
  browser.storageEvent(key, raw("denied"));
  assert.equal(controller.getState().choice, "denied");
  assert.equal(controller.getState().permitted, false);
  browser.storageEvent(null, null);
  assert.equal(controller.getState().choice, null);
  assert.equal(controller.getState().shouldAsk, true);
  browser.storageEvent(key, "invalid json");
  assert.equal(controller.getState().permitted, false);
});

test("expiry timers clamp long TTLs and re-arm without extending expiry", async (t) => {
  const maxDelay = 2_147_483_647;
  const { browser, controller } = setup(t, "consent-required", maxDelay + 100);
  await controller.start();
  controller.choose("granted");
  assert.equal([...browser.timers.values()][0].delay, maxDelay);
  browser.advance(maxDelay);
  assert.equal(controller.getState().permitted, true);
  assert.equal([...browser.timers.values()][0].delay, 100);
  browser.advance(100);
  assert.equal(controller.getState().permitted, false);
  assert.equal(browser.timers.size, 0);
});

test("dispose cleans timers and ignores late region resolution and events", async (t) => {
  const browser = new FakeWindow();
  t.mock.method(Date, "now", () => browser.now);
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const controller = createConsentController({
    storageKey: key,
    preferenceTtlMs: 100,
    resolveRegion: () => pending,
    window: browser,
  });
  let emissions = 0;
  controller.subscribe(() => {
    emissions += 1;
  });
  controller.choose("granted");
  const started = controller.start();
  await Promise.resolve();
  assert.equal(browser.timers.size, 1);
  controller.dispose();
  const count = emissions;
  resolve("notice-only");
  await started;
  controller.choose("denied");
  browser.storageEvent(key, raw("denied"));
  browser.dispatchEvent(new Event("focus"));
  assert.equal(emissions, count);
  assert.equal(browser.timers.size, 0);
  assert.equal(controller.getState().resolved, false);
  assert.equal(controller.getState().permitted, false);
  controller.dispose();
  await controller.start();
});

test("SSR remains fail-closed without accessing the region resolver", async () => {
  let calls = 0;
  const controller = createConsentController({
    storageKey: key,
    preferenceTtlMs: 100,
    resolveRegion: async () => {
      calls += 1;
      return "notice-only";
    },
  });
  await controller.start();
  controller.choose("granted");
  assert.equal(calls, 0);
  assert.equal(controller.getState().resolved, true);
  assert.equal(controller.getState().region, "unknown");
  assert.equal(controller.getState().permitted, false);
  assert.equal(controller.getState().shouldAsk, false);
  controller.dispose();
});

test("rejects invalid configuration before using storage", () => {
  const options = {
    storageKey: key,
    preferenceTtlMs: 100,
    resolveRegion: async () => "unknown",
  };
  assert.throws(
    () => createConsentController({ ...options, preferenceTtlMs: 0 }),
    RangeError,
  );
  assert.throws(
    () => createConsentController({ ...options, storageKey: " " }),
    TypeError,
  );
});
