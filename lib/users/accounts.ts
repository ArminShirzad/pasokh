import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser } from "@/lib/workspace";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { clearLoginFailures, isLoginThrottled, recordLoginFailure } from "./login-throttle";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AccountError extends Error {
  // `message` is a translation key, so the form can show it in either language.
  constructor(message: AccountErrorKey) {
    super(message);
    this.name = "AccountError";
  }
}

const ACCOUNT_ERROR_KEYS = [
  "Enter a valid email address.",
  "Password must be at least 8 characters.",
  "Password is too long.",
  "Passwords do not match.",
  "Setup is already complete. Sign in instead.",
  "This invitation is no longer valid.",
  "An account with this email already exists. Sign in to accept the invitation.",
] as const;
export type AccountErrorKey = (typeof ACCOUNT_ERROR_KEYS)[number];

/**
 * Forms carry the error back in ?error=, which anyone can edit; only a known
 * key may reach t(), which has no entry (and no fallback) for arbitrary text.
 */
export function accountErrorFromQuery(value: string | undefined): AccountErrorKey | null {
  return ACCOUNT_ERROR_KEYS.find((key) => key === value) ?? null;
}

function validate(email: string, password: string, confirm: string) {
  if (!EMAIL_SHAPE.test(email)) throw new AccountError("Enter a valid email address.");
  const problem = passwordProblem(password);
  if (problem) throw new AccountError(problem);
  if (password !== confirm) throw new AccountError("Passwords do not match.");
}

/** True until the first account exists; the setup page is open only then. */
export async function needsFirstRunSetup(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

/**
 * Creates the instance owner. Runs under a transaction-scoped advisory lock and
 * re-checks inside it, so two setup submissions racing on a fresh install
 * cannot both create an owner.
 */
export async function createFirstOwner(input: {
  name: string;
  email: string;
  password: string;
  confirm: string;
  workspaceName: string;
}): Promise<{ userId: string; email: string }> {
  const email = normalizeEmail(input.email);
  validate(email, input.password, input.confirm);
  const passwordHash = await hashPassword(input.password);
  const workspaceName = input.workspaceName.trim() || input.name.trim() || email.split("@")[0];

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pasokh:first-run-setup'))`;
    if ((await tx.user.count()) > 0) throw new AccountError("Setup is already complete. Sign in instead.");
    const user = await tx.user.create({
      data: { email, name: input.name.trim() || null, passwordHash, emailVerified: new Date() },
    });
    await tx.workspace.create({
      data: {
        name: workspaceName,
        ownerId: user.id,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    return { userId: user.id, email };
  });
}

/**
 * An invited teammate sets a password for the invited address. The pending
 * invitation is accepted by the same path a magic-link sign-in uses
 * (ensureWorkspaceForUser), so both routes into a workspace stay identical.
 */
export async function createInvitedUser(input: {
  token: string;
  name: string;
  password: string;
  confirm: string;
}): Promise<{ userId: string; email: string }> {
  const invitation = await prisma.workspaceInvitation.findUnique({ where: { token: input.token } });
  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) {
    throw new AccountError("This invitation is no longer valid.");
  }
  const email = normalizeEmail(invitation.email);
  validate(email, input.password, input.confirm);
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new AccountError("An account with this email already exists. Sign in to accept the invitation.");
  }
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim() || null,
      passwordHash: await hashPassword(input.password),
      // Possessing the invitation link proves access to the invited address.
      emailVerified: new Date(),
    },
  });
  await ensureWorkspaceForUser(user.id, email);
  return { userId: user.id, email };
}

export type CredentialCheck =
  | { ok: true; user: { id: string; email: string; name: string | null } }
  | { ok: false; reason: "throttled" | "invalid" };

export async function checkCredentials(rawEmail: string, password: string, ip: string | null): Promise<CredentialCheck> {
  const email = normalizeEmail(rawEmail);
  if (await isLoginThrottled(email, ip)) return { ok: false, reason: "throttled" };
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  // Verify even when the user is missing so response time does not reveal
  // which addresses have accounts.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !valid) {
    await recordLoginFailure(email, ip);
    return { ok: false, reason: "invalid" };
  }
  await clearLoginFailures(email);
  return { ok: true, user: { id: user.id, email: user.email ?? email, name: user.name } };
}

/** Sets a new password; used by the CLI reset script and account settings. */
export async function setPassword(rawEmail: string, password: string): Promise<boolean> {
  const problem = passwordProblem(password);
  if (problem) throw new AccountError(problem);
  const email = normalizeEmail(rawEmail);
  const result = await prisma.user.updateMany({
    where: { email },
    data: { passwordHash: await hashPassword(password) },
  });
  if (result.count > 0) await clearLoginFailures(email);
  return result.count > 0;
}

// A valid hash of a random string, so a lookup miss costs the same as a hit.
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64, 1).toString("base64");
