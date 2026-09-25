import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string | null;
      organizationName: string | null;
      role: "member" | "admin" | "superAdmin" | "stylist";
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    organizationId?: string | null;
    organizationName?: string | null;
    role?: "member" | "admin" | "superAdmin" | "stylist";
  }
}
