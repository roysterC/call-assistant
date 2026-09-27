/**
 * Dev-only. Plays scripted phone calls through our own receptionist, with the
 * real model and the real booking code, and checks what actually happened.
 *
 * The point is to judge a model on calls rather than on impressions: every
 * scenario ends by looking at the diary, not at what the receptionist said it
 * did. Run it after changing the prompt, the tools or RECEPTIONIST_MODEL.
 *
 * It writes to the diary it is pointed at, so it refuses to run against
 * anything but a local database. Everything it books is cancelled at the end.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=… npx tsx scripts/receptionist-calls.ts            # every scenario
 *   ANTHROPIC_API_KEY=… npx tsx scripts/receptionist-calls.ts cancel     # names containing "cancel"
 *   RECEPTIONIST_MODEL=claude-sonnet-5 npx tsx scripts/receptionist-calls.ts
 *
 * Scripted callers do not listen, so a scenario can drift from the
 * conversation the model steers towards. The checks are on outcomes that must
 * hold whatever route the call took; read the transcripts for the rest.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
// Cloud coding sessions keep ANTHROPIC_API_KEY for their own sign-in, so the
// key for these calls can be given as STRESS_ANTHROPIC_API_KEY instead.
if (!process.env.ANTHROPIC_API_KEY && process.env.STRESS_ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.STRESS_ANTHROPIC_API_KEY;
}

interface Scenario {
  name: string;
  /** Caller ID for the call; null is withheld. */
  caller: string | null;
  /** Set up anything the call needs, e.g. an existing booking to cancel. */
  before?: (ctx: Ctx) => Promise<void>;
  lines: string[];
  /** Checks on what happened. Each returns a failure message, or null. */
  checks: Array<(ctx: Ctx, run: Run) => Promise<string | null> | string | null>;
}

interface Ctx {
  organizationId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
}

interface Run {
  transcript: string[];
  tools: Array<{ name: string; ok: boolean; result: unknown }>;
  firstTextMs: number[];
}

const DAY = 24 * 60 * 60 * 1000;

function nextWeekday(target: number): string {
  const d = new Date();
  do d.setTime(d.getTime() + DAY);
  while (d.getDay() !== target);
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

const SCENARIOS: Scenario[] = [
  {
    name: "books a returning client on the number they ring from",
    caller: "+447700900601",
    lines: [
      `Hi, could I book a cut and finish on ${nextWeekday(2)} please?`,
      "I've been before, yes.",
      "The earliest one please.",
      "It's Sarah Jones.",
      "Yes, that's right.",
      "Yes, that number's fine.",
      "No, that's everything, thanks.",
    ],
    checks: [
      async ({ prisma, organizationId }) => {
        const appt = await prisma.appointment.findFirst({
          where: { organizationId, status: "booked", lead: { phone: "+447700900601" } },
        });
        return appt ? null : "no booking in the diary for the caller";
      },
      (_c, run) => (run.tools.some((t) => t.name === "check_availability") ? null : "offered a time without checking the diary"),
    ],
  },
  {
    name: "will not book a new client's colour inside the skin-test window",
    caller: "+447700900602",
    lines: [
      "Hi, can I get a full head colour tomorrow? I've never been to you before.",
      "Oh, okay. What's the earliest you can do then?",
      "It's Priya Shah.",
      "No thanks, I'll think about it. Bye.",
    ],
    checks: [
      async ({ prisma, organizationId }) => {
        const tomorrowEnd = new Date(Date.now() + 2 * DAY);
        const appt = await prisma.appointment.findFirst({
          where: {
            organizationId,
            status: "booked",
            lead: { phone: "+447700900602" },
            startsAt: { lt: tomorrowEnd },
          },
        });
        return appt ? "booked a new client's colour inside 48 hours" : null;
      },
      (_c, run) =>
        /patch|skin/i.test(run.transcript.join(" ")) ? null : "never mentioned the skin test",
    ],
  },
  {
    name: "cancels an existing booking after reading it back",
    caller: "+447700900603",
    before: async ({ prisma, organizationId }) => {
      const lead = await prisma.lead.upsert({
        where: { organizationId_phone: { organizationId, phone: "+447700900603" } },
        update: { name: "Tom Test" },
        create: { organizationId, phone: "+447700900603", name: "Tom Test", source: "phone" },
      });
      const startsAt = new Date(Date.now() + 5 * DAY);
      startsAt.setUTCHours(10, 0, 0, 0);
      await prisma.appointment.create({
        data: {
          organizationId,
          leadId: lead.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 45 * 60 * 1000),
          durationMinutes: 45,
          serviceText: "Cut and finish",
          stylistName: "Jo",
          status: "booked",
          source: "desk",
        },
      });
    },
    lines: [
      "Hi, I need to cancel my appointment please.",
      "Yes, it's this number.",
      "Yes, that's the one.",
      "No, I'll ring back another time. Thanks, bye.",
    ],
    checks: [
      async ({ prisma, organizationId }) => {
        const left = await prisma.appointment.count({
          where: { organizationId, status: "booked", lead: { phone: "+447700900603" } },
        });
        return left === 0 ? null : "the booking is still in the diary";
      },
      (_c, run) =>
        run.tools.findIndex((t) => t.name === "find_appointment") <
        run.tools.findIndex((t) => t.name === "cancel_appointment")
          ? null
          : "cancelled without finding (and reading back) the booking first",
    ],
  },
  {
    name: "asks a withheld caller for their number before booking",
    caller: null,
    lines: [
      `Hi, have you got anything for a blow dry on ${nextWeekday(3)} afternoon?`,
      "That first one please. It's Emma Clarke.",
      "Yes that's right.",
      "It's oh seven seven double oh, nine double oh, six oh four.",
      "Yes, that's it.",
      "No, that's all. Bye.",
    ],
    checks: [
      (_c, run) => {
        const booked = run.transcript.findIndex((l) => l === "  [book_appointment]");
        if (booked === -1) return null;
        const asked = run.transcript.findIndex((l) => l.startsWith("Receptionist:") && /number/i.test(l));
        return asked !== -1 && asked < booked ? null : "booked without asking for a number";
      },
    ],
  },
];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !process.argv.includes("--allow-remote")) {
    console.error("Refusing: DATABASE_URL is not a local database, and this books into it.");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Neither ANTHROPIC_API_KEY nor STRESS_ANTHROPIC_API_KEY is set.");
    process.exit(1);
  }

  const { prisma } = await import("../src/lib/prisma");
  const { startReceptionist, receptionistModel } = await import("../src/lib/receptionist/session");

  const org =
    (await prisma.organization.findFirst({ where: { slug: "shogo" }, select: { id: true } })) ??
    (await prisma.organization.findFirst({ select: { id: true } }));
  if (!org) throw new Error("No organisation in this database.");
  const ctx: Ctx = { organizationId: org.id, prisma };

  const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const scenarios = SCENARIOS.filter((s) => !filter || s.name.includes(filter));
  const testNumbers = SCENARIOS.map((s) => s.caller).filter(Boolean) as string[];
  const startedAt = new Date();

  console.log(`Model: ${receptionistModel()}\n`);
  let failures = 0;
  const allFirst: number[] = [];

  for (const s of scenarios) {
    await s.before?.(ctx);
    const session = await startReceptionist(org.id, { callerNumber: s.caller });
    const run: Run = { transcript: [`Receptionist: ${session.greeting}`], tools: [], firstTextMs: [] };

    for (const line of s.lines) {
      run.transcript.push(`Caller: ${line}`);
      const t0 = Date.now();
      let first: number | null = null;
      const turn = await session.engine.respond(line, {
        onText: () => {
          if (first === null) first = Date.now() - t0;
        },
      });
      if (first !== null) run.firstTextMs.push(first);
      for (const t of turn.tools) {
        const ok = !t.isError && (t.result as { success?: boolean })?.success !== false;
        run.tools.push({ name: t.name, ok, result: t.result });
        run.transcript.push(`  [${t.name}${ok ? "" : " — failed"}]`);
      }
      run.transcript.push(`Receptionist: ${turn.text}`);
    }

    const problems: string[] = [];
    for (const check of s.checks) {
      const p = await check(ctx, run);
      if (p) problems.push(p);
    }
    failures += problems.length ? 1 : 0;
    allFirst.push(...run.firstTextMs);

    console.log(`${problems.length ? "FAIL" : "PASS"}  ${s.name}`);
    for (const p of problems) console.log(`      - ${p}`);
    console.log(run.transcript.map((l) => `      ${l}`).join("\n"));
    const avg = run.firstTextMs.reduce((a, b) => a + b, 0) / Math.max(run.firstTextMs.length, 1);
    console.log(`      first word: avg ${(avg / 1000).toFixed(2)}s over ${run.firstTextMs.length} turns\n`);
  }

  // Tidy up: nothing this run booked stays in the diary.
  const tidied = await prisma.appointment.updateMany({
    where: {
      organizationId: org.id,
      status: "booked",
      createdAt: { gte: new Date(startedAt.getTime() - 60_000) },
      lead: { phone: { in: testNumbers } },
    },
    data: { status: "cancelled" },
  });

  allFirst.sort((a, b) => a - b);
  const pct = (p: number) => allFirst[Math.min(allFirst.length - 1, Math.floor(p * allFirst.length))] ?? 0;
  console.log(
    `${scenarios.length - failures}/${scenarios.length} passed. First word: median ${(pct(0.5) / 1000).toFixed(2)}s, ` +
      `slowest 10% ${(pct(0.9) / 1000).toFixed(2)}s. Cancelled ${tidied.count} test booking(s).`
  );
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
