/**
 * What the uptime monitor asks: is the CRM up, can it reach its database,
 * is the phone line's voice server answering, and is last night's backup
 * there. Public, so it says yes or no and how long things took, never more.
 */

import { stat, readFile } from "fs/promises";
import { prisma } from "@/lib/prisma";

export interface Check {
  ok: boolean;
  ms?: number;
  /** Why, when there is something to say: "not configured", "never run". */
  note?: string;
}

async function timed(fn: () => Promise<unknown>, timeoutMs: number): Promise<Check> {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs)),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  }
}

export function checkDatabase(): Promise<Check> {
  return timed(() => prisma.$queryRaw`SELECT 1`, 3000);
}

/** The voice server, if this box runs one (RECEPTIONIST_VOICE_URL set). */
export async function checkVoice(): Promise<Check> {
  if (!process.env.RECEPTIONIST_VOICE_URL) return { ok: true, note: "not configured" };
  const port = Number(process.env.VOICE_PORT || 4610);
  return timed(async () => {
    const res = await fetch(`http://127.0.0.1:${port}/voice/health`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
  }, 3000);
}

/** Written by scripts/backup-db.sh after each backup reaches off-site storage. */
export const BACKUP_STATUS_FILE =
  process.env.BACKUP_STATUS_FILE || "/home/deploy/backups/last-success";

/** A nightly backup older than this means last night's did not happen. */
export const BACKUP_MAX_AGE_HOURS = 26;

export async function checkBackup(now = Date.now()): Promise<Check & { ageHours?: number }> {
  try {
    // A path on the box, not part of the app: the bundler must not trace it.
    const [info, text] = await Promise.all([
      stat(/*turbopackIgnore: true*/ BACKUP_STATUS_FILE),
      readFile(/*turbopackIgnore: true*/ BACKUP_STATUS_FILE, "utf8"),
    ]);
    const at = Date.parse(text.trim()) || info.mtimeMs;
    const ageHours = Math.round(((now - at) / 3_600_000) * 10) / 10;
    return { ok: ageHours <= BACKUP_MAX_AGE_HOURS, ageHours };
  } catch {
    return { ok: false, note: "no backup has completed yet" };
  }
}
