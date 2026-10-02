import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";
import { isEmailAllowedToSignIn } from "@/lib/env";
import { checkCredentials } from "@/lib/users/accounts";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

const emailFrom = process.env.EMAIL_FROM ?? "Pasokh <login@example.com>";
// Setting EMAIL_SERVER switches magic links to your own SMTP server; otherwise
// a real RESEND_API_KEY enables them through Resend. With neither, Pasokh is
// password-only, which is how a fresh install starts: nobody should need a mail
// server just to log in to their own instance.
const smtpServer = process.env.EMAIL_SERVER;
const resendKey = process.env.RESEND_API_KEY;
const hasResend = Boolean(resendKey && resendKey !== "re_..." && resendKey.startsWith("re_"));

export function isEmailLoginEnabled(): boolean {
  return Boolean(smtpServer) || hasResend;
}

/**
 * Provider id the magic-link form has to sign in with. It differs per
 * transport, so it is derived here rather than hardcoded at the call site.
 */
export const EMAIL_PROVIDER_ID = smtpServer ? "nodemailer" : "resend";
export const PASSWORD_PROVIDER_ID = "password";

class ThrottledSignin extends CredentialsSignin {
  code = "throttled";
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

const emailProviders = smtpServer
  ? [Nodemailer({ server: smtpServer, from: emailFrom })]
  : hasResend
    ? [Resend({ apiKey: resendKey, from: emailFrom })]
    : [];

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    Credentials({
      id: PASSWORD_PROVIDER_ID,
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const email = typeof credentials.email === "string" ? credentials.email : "";
        const password = typeof credentials.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const result = await checkCredentials(email, password, clientIp(request));
        if (!result.ok) {
          if (result.reason === "throttled") throw new ThrottledSignin();
          return null;
        }
        if (!isEmailAllowedToSignIn(result.user.email)) return null;
        return result.user;
      },
    }),
    ...emailProviders,
  ],
  callbacks: {
    // For magic links this runs before the link is sent, so a blocked address
    // never receives one, and again when the link is verified.
    async signIn({ user }) {
      return isEmailAllowedToSignIn(user?.email);
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    // Sessions are JWTs (Auth.js only supports password sign-in that way), so a
    // token outlives a deleted account. Checking the user here turns such a
    // token into a signed-out session instead of a dashboard that fails on
    // missing foreign keys.
    async session({ session, token }) {
      const userId = token.sub;
      const user = userId
        ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } })
        : null;
      if (!user) return { ...session, user: undefined } as unknown as typeof session;
      session.user.id = user.id;
      session.user.email = user.email ?? session.user.email;
      session.user.name = user.name ?? session.user.name;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
