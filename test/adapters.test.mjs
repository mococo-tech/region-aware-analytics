import assert from "node:assert/strict";
import test from "node:test";
import { classifyCloudFrontRequest } from "../dist/adapters/cloudfront.js";
import { classifyCloudflareCountry } from "../dist/adapters/cloudflare.js";

const rules = { noticeOnly: ["JP"], consentRequired: ["DE"] };
const trusted = { trustedProxy: true, productionHosts: ["example.com"] };
const request = (headers) => ({ headers });

test("viewer-supplied geography is ignored without an explicit trusted-proxy guarantee", () => {
  const input = request({
    host: "example.com",
    "cloudfront-viewer-country": "JP",
  });
  assert.equal(
    classifyCloudFrontRequest(input, rules, {
      ...trusted,
      trustedProxy: false,
    }),
    "unknown",
  );
  assert.equal(
    classifyCloudFrontRequest(input, rules, {
      productionHosts: ["example.com"],
    }),
    "unknown",
  );
  assert.equal(classifyCloudFrontRequest(input, rules, trusted), "notice-only");
});

test("production hostname matching rejects suffix tricks, preview hosts and ambiguous headers", () => {
  for (const host of [
    "preview.example.com",
    "example.com.evil.test",
    "localhost",
    "example.com, evil.test",
    "example.com:443",
  ]) {
    assert.equal(
      classifyCloudFrontRequest(
        request({ host, "cloudfront-viewer-country": "JP" }),
        rules,
        trusted,
      ),
      "unknown",
    );
  }
  assert.equal(
    classifyCloudFrontRequest(
      request({
        host: "example.com",
        Host: "other.example",
        "cloudfront-viewer-country": "JP",
      }),
      rules,
      trusted,
    ),
    "unknown",
  );
  assert.equal(
    classifyCloudFrontRequest(
      request({ host: ["example.com"], "cloudfront-viewer-country": "JP" }),
      rules,
      trusted,
    ),
    "unknown",
  );
});

test("trusted adapters support Node-style and Fetch-style headers without language inference", () => {
  assert.equal(
    classifyCloudFrontRequest(
      request({ Host: "EXAMPLE.COM", "CloudFront-Viewer-Country": "DE" }),
      rules,
      trusted,
    ),
    "consent-required",
  );
  assert.equal(
    classifyCloudFrontRequest(
      request(
        new Headers({ host: "example.com", "cloudfront-viewer-country": "NZ" }),
      ),
      rules,
      trusted,
    ),
    "unavailable",
  );
  assert.equal(
    classifyCloudFrontRequest(
      request({
        host: "example.com",
        "accept-language": "ja",
        "cf-ipcountry": "JP",
      }),
      rules,
      trusted,
    ),
    "unknown",
  );
  assert.equal(
    classifyCloudFrontRequest(
      request({
        host: "example.com",
        "cloudfront-viewer-country": ["JP", "DE"],
      }),
      rules,
      trusted,
    ),
    "unknown",
  );
});

test("the Cloudflare adapter takes only platform country data, not public headers", () => {
  assert.equal(classifyCloudflareCountry("JP", rules), "notice-only");
  assert.equal(classifyCloudflareCountry("de", rules), "consent-required");
  assert.equal(classifyCloudflareCountry("NZ", rules), "unavailable");
  for (const value of [
    undefined,
    "XX",
    { headers: { "CF-IPCountry": "JP" } },
    new Headers({ "CF-IPCountry": "JP" }),
  ]) {
    assert.equal(classifyCloudflareCountry(value, rules), "unknown");
  }
});

test("both trusted adapters apply the same fallback and explicit-list precedence", () => {
  for (const fallback of ["notice-only", "consent-required"]) {
    const policy = {
      noticeOnly: ["JP", "DE"],
      consentRequired: ["DE"],
      knownCountryFallback: fallback,
    };
    for (const [country, expected] of [
      ["JP", "notice-only"],
      ["DE", "consent-required"],
      ["NZ", fallback],
      ["XX", "unknown"],
      [undefined, "unknown"],
    ]) {
      assert.equal(classifyCloudflareCountry(country, policy), expected);
      assert.equal(
        classifyCloudFrontRequest(
          request({
            host: "example.com",
            "cloudfront-viewer-country": country,
          }),
          policy,
          trusted,
        ),
        expected,
      );
    }
  }
});

test("a permissive fallback never relaxes CloudFront origin or header trust", () => {
  const policy = { ...rules, knownCountryFallback: "notice-only" };
  for (const headers of [
    { host: "preview.example.com", "cloudfront-viewer-country": "NZ" },
    { host: "example.com", "cf-ipcountry": "NZ", "accept-language": "en-NZ" },
    { host: "example.com", "cloudfront-viewer-country": ["NZ", "DE"] },
    { host: "example.com", "cloudfront-viewer-country": "NZ, DE" },
  ]) {
    assert.equal(
      classifyCloudFrontRequest(request(headers), policy, trusted),
      "unknown",
    );
  }
  assert.equal(
    classifyCloudFrontRequest(
      request({ host: "example.com", "cloudfront-viewer-country": "NZ" }),
      policy,
      { ...trusted, trustedProxy: false },
    ),
    "unknown",
  );
});
