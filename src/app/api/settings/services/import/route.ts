/**
 * Read a price list from photos or files, for the owner to check.
 *
 *   POST multipart/form-data, files: up to 5 photos, PDFs or CSV/text files
 *   → { rows, skipped }   nothing is saved (src/lib/price-import.ts)
 *
 * Owners and admins, as for the rest of Settings. The files are read and
 * dropped: no menu is stored.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { receptionistApiKey } from "@/lib/receptionist/session";
import { fileKind, IMPORT_LIMITS, ImportError, readPriceList, type ImportFile } from "@/lib/price-import";
import { recordUsage } from "@/lib/usage/record";

/** A few imports an hour per salon is plenty; more is a loop or a misuse. */
const PER_HOUR = 10;
const g = globalThis as unknown as { __priceImports?: Map<string, number[]> };
const recent: Map<string, number[]> = (g.__priceImports ??= new Map());

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  const now = Date.now();
  const times = (recent.get(ctx.organizationId) ?? []).filter((t) => now - t < 60 * 60_000);
  if (times.length >= PER_HOUR) {
    return NextResponse.json({ error: "That's a lot of price lists in an hour. Try again later." }, { status: 429 });
  }

  const key = await receptionistApiKey(ctx.organizationId);
  if (!key) return NextResponse.json({ error: "No Anthropic API key is set up." }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Those files didn't arrive. Try again." }, { status: 400 });
  }
  const uploads = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (uploads.length === 0) return NextResponse.json({ error: "Add a photo or a file first." }, { status: 400 });
  if (uploads.length > IMPORT_LIMITS.files) {
    return NextResponse.json({ error: `Up to ${IMPORT_LIMITS.files} files at a time.` }, { status: 400 });
  }

  const files: ImportFile[] = [];
  for (const u of uploads) {
    if (!fileKind({ name: u.name, type: u.type })) {
      return NextResponse.json(
        { error: `${u.name} isn't a photo, PDF or CSV. Save it as one of those, or take a photo of it.` },
        { status: 415 }
      );
    }
    if (u.size > IMPORT_LIMITS.bytesPerFile) {
      return NextResponse.json({ error: `${u.name} is over 10 MB.` }, { status: 413 });
    }
    files.push({ name: u.name, type: u.type, data: Buffer.from(await u.arrayBuffer()) });
  }

  recent.set(ctx.organizationId, [...times, now]);
  const started = new Date();
  try {
    const cfg = await getSalonConfig(ctx.organizationId);
    const { result, usage, model } = await readPriceList(new Anthropic({ apiKey: key.apiKey }), files, {
      types: cfg.businessTypes ?? ["hair"],
      existing: cfg.services,
    });
    void recordUsage(ctx.organizationId, {
      source: "setup",
      startedAt: started,
      counts: {
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ImportError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error("[PRICE IMPORT] failed:", err);
    const detail =
      err instanceof Anthropic.RateLimitError
        ? "Busy just now. Try again in a minute."
        : err instanceof Anthropic.BadRequestError
          ? "That file couldn't be read. Try a photo instead."
          : "Something went wrong reading it. Try again.";
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
