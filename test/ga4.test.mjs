import assert from "node:assert/strict";
import test from "node:test";
import { createGa4Provider } from "../dist/ga4.js";

const measurementId = "G-TEST1234";
const origin = "https://example.com";
const disableKey = `ga-disable-${measurementId}`;
const page = {
  url: `${origin}/contact/?email=person%40example.net#private-receipt`,
  title: "Contact",
  referrer: "https://referrer.example/private/thread?email=person#receipt",
};

function fakeWindow({ cookieAccess = "normal" } = {}) {
  const scripts = [];
  const cookieWrites = [];
  const cookies = new Map([
    ["_ga", "site-client"],
    ["_ga_TEST1234", "this-property"],
    ["_ga_OTHER", "other-property"],
    ["session_id", "necessary-session"],
  ]);
  const document = {
    get cookie() {
      if (cookieAccess === "read-blocked") {
        throw new DOMException("Cookies unavailable", "SecurityError");
      }
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(value) {
      if (cookieAccess === "write-blocked") {
        throw new DOMException("Cookies unavailable", "SecurityError");
      }
      cookieWrites.push(value);
      const [pair] = value.split(";");
      const [name, contents] = pair.split("=");
      if (value.includes("Max-Age=0")) cookies.delete(name);
      else cookies.set(name, contents);
    },
    createElement(tag) {
      assert.equal(tag, "script");
      return {};
    },
    head: {
      append(script) {
        scripts.push(script);
      },
    },
  };
  const win = { document };
  return {
    win,
    scripts,
    cookies,
    cookieWrites,
    commands: () => (win.dataLayer ?? []).map((entry) => Array.from(entry)),
  };
}

function providerFor(fake, overrides = {}) {
  return createGa4Provider({
    measurementId,
    origin,
    window: fake.win,
    events: { form_complete: { form: ["company", "support"] } },
    ...overrides,
  });
}

test("GA4 and shared core import and construct safely without a browser", async () => {
  assert.equal(typeof globalThis.window, "undefined");
  const { canMeasure } = await import("../dist/core.js");
  assert.equal(canMeasure("unknown", "granted"), false);
  const provider = createGa4Provider({ measurementId, origin });
  assert.doesNotThrow(() => provider.setEnabled(true));
  assert.equal(provider.pageView(page), false);
  assert.equal(provider.track("form_complete", { form: "company" }), false);
  assert.doesNotThrow(() => provider.dispose());
});

test("invalid IDs, origins and lifetimes are rejected before creating a network entry point", () => {
  const fake = fakeWindow();
  for (const id of ["UA-123", "G-X&other=1", "G-TEST/123", "", "G-test"]) {
    assert.throws(() => providerFor(fake, { measurementId: id }), TypeError);
  }
  for (const invalidOrigin of [
    "/",
    "https://example.com/base",
    "https://example.com/?q=x",
    "javascript:alert(1)",
    "file:///",
  ]) {
    assert.throws(
      () => providerFor(fake, { origin: invalidOrigin }),
      TypeError,
    );
  }
  for (const cookieDurationSeconds of [0, -1, 0.5, Infinity, NaN]) {
    assert.throws(
      () => providerFor(fake, { cookieDurationSeconds }),
      RangeError,
    );
  }
  assert.equal(fake.scripts.length, 0);
  assert.equal(fake.commands().length, 0);
});

test("construction and enabling do not load Google before a valid page view", () => {
  const fake = fakeWindow();
  const provider = providerFor(fake);
  assert.equal(fake.win[disableKey], true);
  assert.equal(provider.pageView(page), false);
  assert.equal(provider.track("form_complete", { form: "company" }), false);
  provider.setEnabled(true);
  assert.equal(fake.scripts.length, 0);
  assert.equal(fake.commands().length, 0);
  assert.equal(provider.track("form_complete", { form: "company" }), false);
});

test("first page loads one fixed Google script and configures limited collection before the manual view", () => {
  const fake = fakeWindow();
  const provider = providerFor(fake, { cookieDurationSeconds: 86400 });
  provider.setEnabled(true);
  assert.equal(provider.pageView(page), true);
  assert.equal(fake.win[disableKey], false);
  assert.equal(fake.scripts.length, 1);
  assert.deepEqual(fake.scripts[0], {
    async: true,
    src: `https://www.googletagmanager.com/gtag/js?id=${measurementId}`,
    referrerPolicy: "origin",
  });
  assert.equal(Array.isArray(fake.win.dataLayer[0]), false);
  const commands = fake.commands();
  assert.deepEqual(commands[0], [
    "consent",
    "default",
    {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    },
  ]);
  const configuration = commands.find(([command]) => command === "config");
  assert.deepEqual(configuration, [
    "config",
    measurementId,
    {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_expires: 86400,
      cookie_update: false,
      cookie_domain: "example.com",
      cookie_flags: "SameSite=Lax;Secure",
    },
  ]);
  const view = commands.find(
    ([command, name]) => command === "event" && name === "page_view",
  );
  assert.deepEqual(view, [
    "event",
    "page_view",
    {
      page_location: `${origin}/contact/`,
      page_title: "Contact",
      page_referrer: "https://referrer.example/",
      send_to: measurementId,
    },
  ]);
  assert.ok(commands.indexOf(configuration) < commands.indexOf(view));
  assert.doesNotMatch(
    JSON.stringify(commands),
    /person(?:%40|@)|private-receipt|private\/thread/,
  );
});

test("navigation updates global safe page fields and emits only one view per explicit call", () => {
  const fake = fakeWindow();
  const provider = providerFor(fake);
  provider.setEnabled(true);
  provider.pageView(page);
  provider.pageView({
    url: `${origin}/support/?name=private#private`,
    title: "Support",
    referrer: `${origin}/contact/?name=private#private`,
  });
  const commands = fake.commands();
  assert.equal(fake.scripts.length, 1);
  assert.equal(commands.filter(([name]) => name === "config").length, 1);
  assert.equal(
    commands.filter(([kind, name]) => kind === "event" && name === "page_view")
      .length,
    2,
  );
  assert.deepEqual(commands.at(-2), [
    "set",
    {
      page_location: `${origin}/support/`,
      page_title: "Support",
      page_referrer: `${origin}/contact/`,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(commands), /name=private|#private/);
});

test("custom events require exact names, own keys, counts and enumerated values", () => {
  const fake = fakeWindow();
  const schemas = Object.assign(
    Object.create({ inherited_event: { form: ["company"] } }),
    {
      form_complete: { form: ["company", "support"] },
    },
  );
  const provider = providerFor(fake, { events: schemas });
  provider.setEnabled(true);
  provider.pageView(page);
  const initial = fake.commands().length;
  for (const [name, values] of [
    ["unknown", { form: "company" }],
    ["inherited_event", { form: "company" }],
    ["toString", {}],
    ["form_complete", {}],
    ["form_complete", { form: "company", email: "person@example.net" }],
    ["form_complete", { form: "private free text" }],
    ["form_complete", { wrong_key: "company" }],
    ["form_complete", { form: ["company"] }],
    ["form_complete", Object.create({ form: "company" })],
  ])
    assert.equal(provider.track(name, values), false);
  assert.equal(fake.commands().length, initial);
  assert.equal(provider.track("form_complete", { form: "company" }), true);
  assert.deepEqual(fake.commands().at(-1), [
    "event",
    "form_complete",
    {
      form: "company",
      send_to: measurementId,
    },
  ]);
});

test("rejected canonical stops ongoing collection until a valid replacement view is supplied", () => {
  const fake = fakeWindow();
  const provider = providerFor(fake);
  provider.setEnabled(true);
  provider.pageView(page);
  const initial = fake.commands().length;
  assert.equal(
    provider.pageView({ ...page, url: "https://other.example/private" }),
    false,
  );
  assert.equal(fake.win[disableKey], true);
  assert.equal(provider.track("form_complete", { form: "company" }), false);
  provider.setEnabled(true);
  assert.equal(provider.track("form_complete", { form: "company" }), false);
  assert.equal(fake.commands().length, initial);
  assert.equal(provider.pageView({ ...page, url: `${origin}/` }), true);
  assert.equal(fake.scripts.length, 1);
});

test("withdrawing permission stops future commands and removes only this provider's cookies", () => {
  const fake = fakeWindow();
  const provider = providerFor(fake);
  provider.setEnabled(true);
  provider.pageView(page);
  const initial = fake.commands().length;
  provider.setEnabled(false);
  assert.equal(fake.win[disableKey], true);
  assert.equal(provider.pageView(page), false);
  assert.equal(provider.track("form_complete", { form: "company" }), false);
  assert.equal(fake.commands().length, initial);
  assert.equal(fake.scripts.length, 1);
  assert.equal(fake.cookies.has("_ga"), false);
  assert.equal(fake.cookies.has("_ga_TEST1234"), false);
  assert.equal(fake.cookies.get("_ga_OTHER"), "other-property");
  assert.equal(fake.cookies.get("session_id"), "necessary-session");
  assert.equal(fake.cookieWrites.length, 6);
  assert.ok(
    fake.cookieWrites.every(
      (value) => value.includes("Max-Age=0") && value.includes("Secure"),
    ),
  );
});

test("navigation pause blocks collection without deleting the browser identity", () => {
  const fake = fakeWindow();
  const provider = providerFor(fake);
  provider.setEnabled(true);
  provider.pageView(page);
  const initial = fake.commands().length;
  provider.setEnabled(false, { clearCookies: false });
  assert.equal(fake.win[disableKey], true);
  assert.equal(provider.pageView(page), false);
  assert.equal(provider.track("form_complete", { form: "company" }), false);
  assert.equal(fake.commands().length, initial);
  assert.equal(fake.cookieWrites.length, 0);
  assert.equal(fake.cookies.get("_ga"), "site-client");
  provider.setEnabled(true);
  assert.equal(provider.pageView({ ...page, url: `${origin}/next/` }), true);
  assert.equal(fake.scripts.length, 1);
  assert.equal(fake.cookies.get("_ga_TEST1234"), "this-property");
});

test("cookie restrictions cannot throw from stop or dispose, and disposal cannot be undone", () => {
  for (const cookieAccess of ["read-blocked", "write-blocked", "normal"]) {
    const fake = fakeWindow({ cookieAccess });
    const provider = providerFor(fake);
    provider.setEnabled(true);
    provider.pageView(page);
    assert.doesNotThrow(() => provider.setEnabled(false));
    assert.equal(fake.win[disableKey], true);
    provider.setEnabled(true);
    assert.doesNotThrow(() => provider.dispose());
    assert.doesNotThrow(() => provider.dispose());
    const initial = fake.commands().length;
    provider.setEnabled(true);
    assert.equal(fake.win[disableKey], true);
    assert.equal(provider.pageView(page), false);
    assert.equal(provider.track("form_complete", { form: "company" }), false);
    assert.equal(fake.commands().length, initial);
  }
});

test("an existing queue function is preserved without replacing unrelated queued commands", () => {
  const fake = fakeWindow();
  const calls = [["existing-command"]];
  const existing = (...args) => calls.push(args);
  fake.win.gtag = existing;
  const provider = providerFor(fake);
  provider.setEnabled(true);
  provider.pageView(page);
  assert.equal(fake.win.gtag, existing);
  assert.deepEqual(calls[0], ["existing-command"]);
  assert.equal(
    calls.filter(([kind, name]) => kind === "event" && name === "page_view")
      .length,
    1,
  );
});
