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

import type { Prisma } from "@/generated/prisma/client";
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
    .replace(/[̀-ͯ]/g, "")
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

export async function signUpSalon(input: {
  salon: unknown;
  name: unknown;
  email: unknown;
  password: unknown;
  language?: unknown;
  now?: Date;
}): Promise<{ ok: true; organizationId: string; salon: string; email: string; userId: string } | Fail> {
  const now = input.now ?? new Date();
  const salon = String(input.salon ?? "").trim().replace(/\s+/g, " ").slice(0, SALON_NAME_MAX);
  if (!salon) return { ok: false, status: 400, error: "Enter your salon's name.", code: "salon" };
  const name = String(input.name ?? "").trim().slice(0, 100);
  if (!name) return { ok: false, status: 400, error: "Enter your name.", code: "name" };
  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, status: 400, error: "That email address does not look right.", code: "email" };
  const password = typeof input.password === "string" ? input.password : "";
  const weak = validatePassword(password);
  if (weak) return { ok: false, status: 400, error: weak, code: "weak" };
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const taken = await tx.user.findUnique({ where: { email }, select: { id: true, organizationId: true, role: true } });
    if (taken && !isLeftoverLogin(taken)) {
      return { ok: false as const, status: 409, error: "That email already has a login. Sign in instead.", code: "taken" };
    }
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
