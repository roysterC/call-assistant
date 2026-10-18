import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const dir = mkdtempSync(join(tmpdir(), "health-"));
const file = join(dir, "last-success");

async function load() {
  vi.resetModules();
  vi.stubEnv("BACKUP_STATUS_FILE", file);
  return import("./health");
}

afterEach(() => vi.unstubAllEnvs());

describe("checkBackup", () => {
  const now = Date.parse("2026-10-18T09:00:00Z");

  it("is fine the morning after a night's backup", async () => {
    writeFileSync(file, "2026-10-18T02:15:00Z\n");
    const { checkBackup } = await load();
    expect(await checkBackup(now)).toEqual({ ok: true, ageHours: 6.8 });
  });

  it("is stale once a night has been missed", async () => {
    writeFileSync(file, "2026-10-17T02:15:00Z\n");
    const { checkBackup } = await load();
    expect(await checkBackup(now)).toMatchObject({ ok: false, ageHours: 30.8 });
  });

  it("is stale, and says so, when no backup has ever finished", async () => {
    vi.resetModules();
    vi.stubEnv("BACKUP_STATUS_FILE", join(dir, "missing"));
    const { checkBackup } = await import("./health");
    expect(await checkBackup(now)).toEqual({ ok: false, note: "no backup has completed yet" });
  });
});
