/**
 * A salon signing itself up (/signup): its name, the owner's name, email and
 * password. Makes the salon on the 14-day free trial (src/lib/plan.ts),
 * starting now, and the owner's login, then the owner signs in and is taken
 * through onboarding (hours, services, team), as an invited owner is. No
 * Kikai step: Kikai is emailed that it happened.
 *
 * Guarded against misuse by an address-based limit and a field only bots
 * fill (the route), an email that must not already have a login, and the
 * trial itself: with no card, no AI tool works, so a made-up salon costs
 * nothing but a few rows, and a paused one is wiped in time (purge.ts).
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { businessTypesOf, starterMenu, starterServices } from "@/lib/business-types";
import { hasOwnSubdomain } from "@/lib/booking-host";
import { isLeftoverLogin, normaliseEmail } from "@/lib/invitations";
import { hashPassword, validatePassword } from "@/lib/password";
import { isLang } from "@/lib/i18n";
import { trialEnd } from "@/lib/plan";

export const SALON_NAME_MAX = 80;

/** "Polished Nails & Co." → "polished-nails-co". */
export function slugFrom(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** A slug for the salon nobody has, that can be its own web address: "mai-nails", else "mai-nails-2", … */
export async function freeSlug(name: string, db: Pick<typeof prisma, "organization"> = prisma): Promise<string> {
  let base = slugFrom(name);
  if (!base || !/^[a-z]/.test(base)) base = `salon-${base}`.replace(/-+$/, "");
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!hasOwnSubdomain(slug)) continue;
    const taken = await db.organization.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** The salon's settings to start with: a nail salon, with the starter price list to edit. */
export function starterSettings(businessName: string) {
  const types = businessTypesOf("nails");
  return {
    types,
    settings: {
      businessName,
      diaryEnabled: true,
      menu: starterMenu(types) as unknown as Prisma.InputJsonValue,
      services: starterServices(types) as unknown as Prisma.InputJsonValue,
    },
  };
}

type Fail = { ok: false; status: number; error: string; code: string };

export interface SignUpInput {
  salon: unknown;
  name: unknown;
  email: unknown;
  password: unknown;
  language?: unknown;
  now?: Date;
}

/** What is wrong with the form, before anything is made: null when it can go ahead. */
export function signUpProblem(input: SignUpInput): Fail | null {
  if (!cleanSalon(input.salon)) return { ok: false, status: 400, error: "Enter your salon's name.", code: "salon" };
  if (!String(input.name ?? "").trim()) return { ok: false, status: 400, error: "Enter your name.", code: "name" };
  if (!normaliseEmail(input.email)) return { ok: false, status: 400, error: "That email address does not look right.", code: "email" };
  const weak = validatePassword(typeof input.password === "string" ? input.password : "");
  if (weak) return { ok: false, status: 400, error: weak, code: "weak" };
  return null;
}

function cleanSalon(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").slice(0, SALON_NAME_MAX);
}

const TAKEN: Fail = { ok: false, status: 409, error: "That email already has a login. Sign in instead.", code: "taken" };

export async function signUpSalon(
  input: SignUpInput
): Promise<{ ok: true; organizationId: string; salon: string; email: string; userId: string } | Fail> {
  const problem = signUpProblem(input);
  if (problem) return problem;
  const now = input.now ?? new Date();
  const salon = cleanSalon(input.salon);
  const name = String(input.name ?? "").trim().slice(0, 100);
  const email = normaliseEmail(input.email)!;
  const passwordHash = await hashPassword(input.password as string);

  // Two sign-ups at once can both find a web address free, or both find an
  // email unused: the second is tried again, and sees the first.
  for (let attempt = 0; ; attempt++) {
    try {
      return await create();
    } catch (e) {
      const unique = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!unique || attempt >= 2) throw e;
    }
  }

  function create() {
    return prisma.$transaction(async (tx) => {
      const taken = await tx.user.findUnique({ where: { email }, select: { id: true, organizationId: true, role: true } });
      if (taken && !isLeftoverLogin(taken)) return TAKEN;
      if (taken) await tx.user.delete({ where: { id: taken.id } });
      const { types, settings } = starterSettings(salon);
      const org = await tx.organization.create({
        data: {
          name: salon,
          slug: await freeSlug(salon, tx),
          needsOnboarding: true,
          businessType: types[0],
          alsoOffers: types.slice(1),
          billingStatus: "trialing",
          trialEndsAt: trialEnd(now),
          lastActiveAt: now,
          settings: { create: settings },
        },
        select: { id: true, name: true },
      });
      const user = await tx.user.create({
        data: {
          email,
          name,
          role: "admin",
          organizationId: org.id,
          passwordHash,
          language: isLang(input.language) ? input.language : null,
        },
        select: { id: true },
      });
      return { ok: true as const, organizationId: org.id, salon: org.name, email, userId: user.id };
    });
  }
}
