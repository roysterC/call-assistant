/**
 * Exercises upsertWebsiteLead against the real database, then cleans up.
 * Run with: npx tsx --env-file=.env scripts/_leadkey.ts
 */
import { prisma } from "@/lib/prisma";
import { upsertWebsiteLead } from "@/lib/website-lead";

const SHARED_PHONE = "07700 900999";
const A = "keytest-alex@example.invalid";
const B = "keytest-sam@example.invalid";

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("no organisation");
  const organizationId = org.id;

  const results: [string, boolean, string][] = [];
  const check = (name: string, ok: boolean, detail: string) =>
    results.push([name, ok, detail]);

  // 1. First capture creates a lead.
  const first = await upsertWebsiteLead({
    organizationId,
    email: A,
    name: "Alex Fenn",
    phone: SHARED_PHONE,
    issue: "Boiler servicing, missing calls",
  });

  // 2. A DIFFERENT person on the SAME phone must be a separate lead.
  //    This is the case that used to merge them.
  const second = await upsertWebsiteLead({
    organizationId,
    email: B,
    name: "Sam Okoye",
    phone: SHARED_PHONE,
    issue: "Vets practice, appointment calls",
  });
  check(
    "two people sharing a phone stay separate",
    first.id !== second.id,
    `${first.id} vs ${second.id}`
  );

  // 3. The phone belongs to whoever claimed it first; the second must not
  //    steal it, and must not blow up trying.
  const [alex, sam] = await Promise.all([
    prisma.lead.findUnique({ where: { id: first.id } }),
    prisma.lead.findUnique({ where: { id: second.id } }),
  ]);
  check(
    "first claimant keeps the phone",
    alex?.phone === SHARED_PHONE,
    String(alex?.phone)
  );
  check("second gets no phone rather than a clash", sam?.phone === null, String(sam?.phone));

  // 4. Same person returning (new session, no phone) is the SAME lead.
  const again = await upsertWebsiteLead({
    organizationId,
    email: A,
    name: "Alex",
    issue: "Now asking about a bathroom",
  });
  check("returning visitor reuses their lead", again.id === first.id, again.id);

  // 5. Case and whitespace do not create a second lead.
  const cased = await upsertWebsiteLead({
    organizationId,
    email: "  KeyTest-Alex@Example.Invalid  ",
  });
  check("email is normalised", cased.id === first.id, cased.id);

  // 6. Newer issue wins; name does not regress.
  const alexNow = await prisma.lead.findUnique({ where: { id: first.id } });
  check(
    "newer issue replaces older",
    alexNow?.issue === "Now asking about a bathroom",
    String(alexNow?.issue)
  );
  check(
    "better name is not overwritten by a worse one",
    alexNow?.name === "Alex Fenn",
    String(alexNow?.name)
  );

  let failed = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  [${detail}]`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);

  await prisma.lead.deleteMany({
    where: { organizationId, email: { in: [A, B] } },
  });
  console.log("test leads removed");

  await prisma.$disconnect();
  if (failed) process.exit(1);
}

main();
