import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { splitName } from "@/lib/client-name";

/**
 * Fill a lead's first and last name from `name` when a write sets only `name`.
 *
 * Nine places across the channels write a lead's name as one string. Doing the
 * split here rather than at each of them means a channel added next year
 * cannot forget to, and the client list never shows a name with an empty
 * first/last column beside it. A write that sets either half itself (the
 * desk's client form) is left exactly as given.
 */
function withNameParts<T>(data: T): T {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const d = data as Record<string, unknown>;
  if (!("name" in d) || "firstName" in d || "lastName" in d) return data;
  const name = d.name;
  if (name !== null && typeof name !== "string") return data;
  return { ...d, ...splitName(name) } as T;
}

function withNamePartsMany<T>(data: T): T {
  return (Array.isArray(data) ? data.map(withNameParts) : withNameParts(data)) as T;
}

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter }).$extends({
    query: {
      lead: {
        create({ args, query }) {
          return query({ ...args, data: withNameParts(args.data) });
        },
        update({ args, query }) {
          return query({ ...args, data: withNameParts(args.data) });
        },
        upsert({ args, query }) {
          return query({
            ...args,
            create: withNameParts(args.create),
            update: withNameParts(args.update),
          });
        },
        createMany({ args, query }) {
          return query({ ...args, data: withNamePartsMany(args.data) });
        },
        createManyAndReturn({ args, query }) {
          return query({ ...args, data: withNamePartsMany(args.data) });
        },
        updateMany({ args, query }) {
          return query({ ...args, data: withNameParts(args.data) });
        },
        updateManyAndReturn({ args, query }) {
          return query({ ...args, data: withNameParts(args.data) });
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
