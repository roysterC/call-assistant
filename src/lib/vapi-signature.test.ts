import { beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "crypto";

const SECRET = "a96cf38cfcae64e06fcba42d95367dbd84c2d8fd832663098a0a995513ebee38";

// The module reads VAPI_WEBHOOK_SECRET once at import time, so the env has to
// be in place before it loads.
type SigModule = typeof import("./vapi-signature");
let mod: SigModule;

beforeAll(async () => {
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  // NODE_ENV is already "test" under vitest, which matters: with a secret set
  // the dev bypass is irrelevant, so these tests exercise the real path.
  mod = await import("./vapi-signature");
});

const BODY = JSON.stringify({ message: { type: "end-of-call-report" } });

function hex(payload: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Exactly what Vapi's HMAC credential sends on its defaults. */
function vapiHeaders(
  body: string,
  opts: { timestamp?: number; secret?: string; prefix?: string } = {}
): Headers {
  const ts = String(opts.timestamp ?? Date.now());
  const sig = hex(`${ts}.${body}`, opts.secret ?? SECRET);
  return new Headers({
    "x-timestamp": ts,
    "x-signature": (opts.prefix ?? "") + sig,
  });
}

describe("verifyVapiRequest — Vapi HMAC defaults", () => {
  it("accepts {timestamp}.{body} hex in x-signature", () => {
    expect(mod.verifyVapiRequest(BODY, vapiHeaders(BODY)).ok).toBe(true);
  });

  it("rejects a body that was altered after signing", () => {
    const headers = vapiHeaders(BODY);
    const result = mod.verifyVapiRequest(BODY + " ", headers);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("did not match");
  });

  it("rejects a signature made with a different secret", () => {
    const headers = vapiHeaders(BODY, { secret: "not-the-secret" });
    expect(mod.verifyVapiRequest(BODY, headers).ok).toBe(false);
  });

  it("accepts epoch seconds as well as milliseconds", () => {
    const seconds = Math.floor(Date.now() / 1000);
    expect(mod.verifyVapiRequest(BODY, vapiHeaders(BODY, { timestamp: seconds })).ok).toBe(true);
  });

  it("strips a sha256= style prefix", () => {
    const headers = vapiHeaders(BODY, { prefix: "sha256=" });
    expect(mod.verifyVapiRequest(BODY, headers).ok).toBe(true);
  });

  describe("replay protection", () => {
    it("rejects a signature older than the skew window", () => {
      const old = Date.now() - 10 * 60 * 1000;
      const result = mod.verifyVapiRequest(BODY, vapiHeaders(BODY, { timestamp: old }));
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("outside");
    });

    it("rejects a timestamp far in the future", () => {
      const future = Date.now() + 10 * 60 * 1000;
      expect(mod.verifyVapiRequest(BODY, vapiHeaders(BODY, { timestamp: future })).ok).toBe(false);
    });

    it("tolerates small clock skew", () => {
      const skewed = Date.now() - 60 * 1000;
      expect(mod.verifyVapiRequest(BODY, vapiHeaders(BODY, { timestamp: skewed })).ok).toBe(true);
    });

    it("does not accept a valid signature replayed with a stale timestamp", () => {
      // The timestamp is part of the signed payload, so an attacker cannot
      // swap in a fresh one without invalidating the digest.
      const old = Date.now() - 60 * 60 * 1000;
      const captured = vapiHeaders(BODY, { timestamp: old });
      captured.set("x-timestamp", String(Date.now()));
      expect(mod.verifyVapiRequest(BODY, captured).ok).toBe(false);
    });
  });
});

describe("verifyVapiRequest — legacy schemes", () => {
  it("accepts an HMAC of the body alone when no timestamp is sent", () => {
    const headers = new Headers({ "x-vapi-signature": hex(BODY) });
    expect(mod.verifyVapiRequest(BODY, headers).ok).toBe(true);
  });

  it("accepts the plain shared secret", () => {
    const headers = new Headers({ "x-vapi-secret": SECRET });
    expect(mod.verifyVapiRequest(BODY, headers).ok).toBe(true);
  });

  it("rejects when no signature header is present at all", () => {
    const result = mod.verifyVapiRequest(BODY, new Headers());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no signature or Authorization header");
  });

  it("rejects an arbitrary value in the signature header", () => {
    const headers = new Headers({ "x-signature": "hello" });
    expect(mod.verifyVapiRequest(BODY, headers).ok).toBe(false);
  });
});

describe("verifyVapiRequest — Bearer credential", () => {
  it("accepts the shared secret as a bearer token", () => {
    const headers = new Headers({ authorization: `Bearer ${SECRET}` });
    expect(mod.verifyVapiRequest(BODY, headers).ok).toBe(true);
  });

  it("accepts it without the Bearer prefix", () => {
    expect(mod.verifyVapiRequest(BODY, new Headers({ authorization: SECRET })).ok).toBe(true);
  });

  it("rejects a wrong bearer token", () => {
    const result = mod.verifyVapiRequest(BODY, new Headers({ authorization: "Bearer nope" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("bearer token did not match");
  });

  it("still prefers a valid HMAC when both are present", () => {
    const headers = vapiHeaders(BODY);
    headers.set("authorization", "Bearer nope");
    expect(mod.verifyVapiRequest(BODY, headers).ok).toBe(true);
  });
});

describe("describeAuthHeaders", () => {
  it("reports names and lengths but never values", () => {
    const headers = vapiHeaders(BODY);
    const described = mod.describeAuthHeaders(headers);
    expect(described).toContain("x-signature");
    expect(described).toContain("x-timestamp");
    expect(described).toContain("len=");
    // The digest itself must never reach the logs.
    expect(described).not.toContain(headers.get("x-signature"));
  });

  it("says so when nothing relevant is present", () => {
    expect(mod.describeAuthHeaders(new Headers({ accept: "*/*" }))).toBe("none");
  });
});
