/**
 * Who each signed-in API route is for. A route that calls requireTenant is
 * owner-only unless it passes { members: true }; this list is where that
 * decision is written down, and the test fails if a route and the list
 * disagree — or a new route has not been decided at all.
 *
 *   members — the salon's staff as well as the owner: day-to-day work.
 *   owner   — the owner (admin) and super-admins: the salon's setup, its
 *             websites and chatbot, what it pays, and the persona reset.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

type Access = "members" | "owner";

const ACCESS: Record<string, Partial<Record<string, Access>>> = {
  "appointments/[id]": { PATCH: "members" },
  appointments: { GET: "members", PATCH: "members", POST: "members" },
  callbacks: { GET: "members", PATCH: "members" },
  calls: { GET: "members" },
  "clients/[id]": { GET: "members", PATCH: "members" },
  clients: { GET: "members", POST: "members" },
  "conversations/[id]/handoff": { POST: "members" },
  "conversations/[id]/persona-reset": { PATCH: "owner" },
  "conversations/[id]/read": { PATCH: "members" },
  "conversations/[id]/reply": { POST: "members" },
  "conversations/[id]": { GET: "members" },
  "conversations/[id]/star": { PATCH: "members" },
  conversations: { GET: "members" },
  dashboard: { GET: "members" },
  leads: { GET: "members" },
  me: { GET: "members" },
  "phone-numbers": { GET: "members" },
  // The lab is for super-admins; the route checks that after requireTenant,
  // in a helper both handlers share.
  "receptionist/lab": { helper: "owner" },
  "receptionist/voice-token": { POST: "owner" },
  sales: { GET: "members" },
  settings: { GET: "members", PUT: "owner" },
  stats: { GET: "members" },
  "time-blocks/[id]": { PATCH: "members", DELETE: "members" },
  "time-blocks": { GET: "members", POST: "members" },
  usage: { GET: "owner" },
  "voice-booking": { POST: "members", DELETE: "members" },
  "voice-booking/token": { POST: "members" },
  "website-chat/analytics": { GET: "owner" },
  // DELETE is requireSuperAdmin, so not listed here.
  "websites/[id]": { GET: "owner", PUT: "owner" },
  websites: { GET: "owner", POST: "owner" },
};

const API = join(__dirname, "..", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

/**
 * For each exported handler that calls requireTenant, who it lets in. A call
 * outside the handlers (a helper they share) is listed as "helper", so it
 * cannot open a route to members unseen.
 */
function accessIn(source: string): Record<string, Access> {
  const found: Record<string, Access> = {};
  const [preamble, ...handlers] = source.split(/(?=^export async function )/m);
  const who = (code: string): Access =>
    /requireTenant\([^,)]+,\s*\{[^}]*members:\s*true/.test(code) ? "members" : "owner";
  if (preamble.includes("requireTenant(")) found.helper = who(preamble);
  for (const part of handlers) {
    const method = part.match(/^export async function (GET|POST|PUT|PATCH|DELETE)\(/)?.[1];
    if (!method || !part.includes("requireTenant(")) continue;
    found[method] = who(part);
  }
  return found;
}

describe("signed-in API routes", () => {
  const actual: Record<string, Record<string, Access>> = {};
  for (const file of routeFiles(API)) {
    const access = accessIn(readFileSync(file, "utf8"));
    if (Object.keys(access).length) {
      actual[relative(API, file).replace(/\/route\.ts$/, "")] = access;
    }
  }

  it("each let in exactly who the list says", () => {
    expect(actual).toEqual(ACCESS);
  });

  it("keep the salon's setup, websites, chatbot and charges from members", () => {
    expect(actual.settings.PUT).toBe("owner");
    expect(actual.usage.GET).toBe("owner");
    expect(Object.values(actual.websites)).not.toContain("members");
    expect(Object.values(actual["websites/[id]"])).not.toContain("members");
    expect(actual["website-chat/analytics"].GET).toBe("owner");
  });
});
