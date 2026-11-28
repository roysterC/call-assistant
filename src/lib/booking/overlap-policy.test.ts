/**
 * Who may double-book. A person at the desk may: they can see the diary and
 * overbooking is their call. Nothing automatic may: the phone receptionist,
 * chat booking, online booking and the voice assistant all book through the
 * clash check (lib/booking/diary.ts), because none of them can see what they
 * would be booking on top of.
 *
 * Overlap is allowed only by `allowOverlap: true` on a write or move, so
 * this pins where that may appear. A new place that needs it is a decision
 * about who may overbook: add it here on purpose, never to quiet the test.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

/** The desk's own routes, behind a signed-in staff member (requireTenant). */
const DESK_ONLY = [
  "app/api/appointments/route.ts", // New booking, the overbook strip
  "app/api/appointments/[id]/route.ts", // Moving or changing a booking
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("who may double-book", () => {
  it("allows an overlap only from the desk's own routes", () => {
    const allowing = sourceFiles(ROOT)
      .filter((f) => /allowOverlap:\s*true/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).split("\\").join("/"))
      .sort();
    expect(allowing).toEqual([...DESK_ONLY].sort());
  });

  it("refuses a clash unless the write says otherwise", () => {
    // The default must be the safe one: a caller that forgets the flag is
    // checked for clashes, never let through.
    const diary = readFileSync(join(ROOT, "lib/booking/diary.ts"), "utf8");
    expect(diary).toMatch(/if \(!write\.allowOverlap\) \{\s*const clash = await findClash/);
    expect(diary).toMatch(/if \(!move\.allowOverlap\)/);
  });
});
