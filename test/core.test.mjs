import assert from "node:assert/strict";
import test from "node:test";
import {
  canMeasure,
  classifyCountry,
  makeChoiceRecord,
  readChoice,
  safePageURL,
  safeReferrer,
} from "../dist/core.js";

// Fictional review choices for tests, not a recommendation about these laws.
const rules = { noticeOnly: ["JP"], consentRequired: ["DE"] };

test("regional permission requires an explicit reviewed rule, not merely a valid country", () => {
  assert.equal(classifyCountry("jp", rules), "notice-only");
  assert.equal(classifyCountry(" de ", rules), "consent-required");
  assert.equal(classifyCountry("NZ", rules), "unavailable");
  assert.equal(
    classifyCountry("JP", { noticeOnly: [], consentRequired: [] }),
    "unavailable",
  );
  for (const value of [
    null,
    undefined,
    {},
    ["JP"],
    "",
    "XX",
    "ZZ",
    "EU",
    "JP, DE",
    "Japan",
  ]) {
    assert.equal(classifyCountry(value, rules), "unknown");
  }
});

test("overlapping region rules cannot bypass consent", () => {
  assert.equal(
    classifyCountry("JP", { noticeOnly: ["jp"], consentRequired: ["JP"] }),
    "consent-required",
  );
});

test("saved consent cannot override a failed or unavailable region decision", () => {
  for (const region of ["unknown", "unavailable", "unexpected"]) {
    for (const choice of ["granted", "denied", null]) {
      assert.equal(canMeasure(region, choice), false);
    }
  }
  assert.equal(canMeasure("notice-only", null), true);
  assert.equal(canMeasure("consent-required", null), false);
  assert.equal(canMeasure("consent-required", "granted"), true);
  assert.equal(canMeasure("notice-only", "denied"), false);
  assert.equal(canMeasure("consent-required", "denied"), false);
  for (const region of ["notice-only", "consent-required"]) {
    assert.equal(canMeasure(region, "granted", true), false);
  }
});

test("a stored choice is valid up to its expiry without extending on read", () => {
  const now = 1_000_000;
  const ttl = 60_000;
  const record = makeChoiceRecord("granted", now, ttl);
  const raw = JSON.stringify(record);
  assert.deepEqual(record, {
    version: 1,
    choice: "granted",
    expiresAt: now + ttl,
  });
  assert.equal(readChoice(raw, now, ttl), "granted");
  assert.equal(readChoice(raw, now + ttl - 1, ttl), "granted");
  assert.equal(readChoice(raw, now + ttl, ttl), null);
  assert.equal(readChoice(raw, now - 1, ttl), null);
  assert.equal(
    readChoice(JSON.stringify(makeChoiceRecord("denied", now, ttl)), now, ttl),
    "denied",
  );
  assert.equal(record.expiresAt, now + ttl);
});

test("malformed, unversioned, future-dated and invalid-time choices do not grant permission", () => {
  const now = 1_000;
  const ttl = 100;
  for (const raw of [
    null,
    "{",
    "null",
    "true",
    "[]",
    JSON.stringify({ choice: "granted", expiresAt: 1050 }),
    JSON.stringify({ version: 2, choice: "granted", expiresAt: 1050 }),
    JSON.stringify({ version: 1, choice: "yes", expiresAt: 1050 }),
    JSON.stringify({ version: 1, choice: "granted", expiresAt: "1050" }),
    JSON.stringify({ version: 1, choice: "granted", expiresAt: 1101 }),
  ])
    assert.equal(readChoice(raw, now, ttl), null);
  const raw = JSON.stringify(makeChoiceRecord("granted", now, ttl));
  for (const invalid of [0, -1, Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(readChoice(raw, now, invalid), null);
    assert.throws(() => makeChoiceRecord("granted", now, invalid), RangeError);
  }
  for (const invalidNow of [-1, Infinity, NaN]) {
    assert.equal(readChoice(raw, invalidNow, ttl), null);
    assert.throws(
      () => makeChoiceRecord("granted", invalidNow, ttl),
      RangeError,
    );
  }
  assert.throws(() => makeChoiceRecord("yes", now, ttl), TypeError);
});

test("measurement URLs discard form-like queries, hashes and external or invalid canonicals", () => {
  assert.equal(
    safePageURL(
      "https://example.com/contact/?email=user%40example.net#receipt-private",
      "https://example.com",
    ),
    "https://example.com/contact/",
  );
  assert.equal(
    safePageURL("https://example.com/support", "https://example.com/"),
    "https://example.com/support",
  );
  for (const url of [
    null,
    "",
    "/contact/",
    "https://other.example/contact/",
    "javascript:alert(1)",
    "data:text/html,test",
  ]) {
    assert.equal(safePageURL(url, "https://example.com"), null);
  }
  assert.equal(
    safePageURL("https://example.com/contact/", "https://example.com/base"),
    null,
  );
  assert.equal(safePageURL("file:///private/file", "file:///"), null);
});

test("external referrers retain no user-specific path, query, hash or credentials", () => {
  assert.equal(
    safeReferrer(
      "https://user:secret@example.net/private/thread?email=test#receipt",
    ),
    "https://example.net/",
  );
  for (const value of [
    "",
    "/private",
    "file:///private/data",
    "javascript:alert(1)",
    "data:text/html,test",
  ]) {
    assert.equal(safeReferrer(value), "");
  }
});
