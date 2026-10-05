import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { clientIp, loginThrottle } from "@/lib/login-throttle";

/** Too many wrong passwords; the login page says so instead of "invalid". */
class TooManyAttempts extends CredentialsSignin {
  code = "too_many_attempts";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = String(credentials?.email || "")
          .toLowerCase()
          .trim();
        const password = String(credentials?.password || "");
        if (!email || !password) return null;

        const ip = clientIp(request.headers);
        if (!loginThrottle.allowed(email, ip)) throw new TooManyAttempts();

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            organizationId: true,
            role: true,
            sessionVersion: true,
            organization: { select: { name: true } },
          },
        });

        const ok = Boolean(user?.passwordHash) && (await verifyPassword(password, user!.passwordHash!));
        if (!user || !ok) {
          loginThrottle.fail(email, ip);
          return null;
        }
        loginThrottle.succeed(email);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          organizationId: user.organizationId,
          organizationName: user.organization?.name || null,
          role: user.role,
          sessionVersion: user.sessionVersion,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as typeof user & {
          organizationId?: string | null;
          organizationName?: string | null;
          role?: string;
          sessionVersion?: number;
        };
        token.userId = u.id;
        token.organizationId = u.organizationId || null;
        token.organizationName = u.organizationName || null;
        token.role = (u.role || "member") as NonNullable<typeof token.role>;
        token.sessionVersion = u.sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: (token.userId as string) || session.user.id,
          organizationId: (token.organizationId as string | null) || null,
          organizationName:
            (token.organizationName as string | null) || null,
          role:
            (token.role as "member" | "admin" | "superAdmin" | "stylist") || "member",
          // Sessions from before this was recorded count as the first.
          sessionVersion: token.sessionVersion ?? 0,
        },
      };
    },
  },
  pages: { signIn: "/login" },
});
