import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthError } from "next-auth";
import AuthCard, { Field, FormError, SubmitButton } from "@/components/auth-card";
import InvitationAcceptCard from "@/components/invitation-accept-card";
import { PASSWORD_PROVIDER_ID, auth, signIn } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getI18n } from "@/lib/i18n/server";
import { AccountError, accountErrorFromQuery, createInvitedUser } from "@/lib/users/accounts";

type InvitePageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Accept Workspace Invitation - Pasokh"),
    robots: { index: false, follow: false },
  };
}

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
  const { t, label } = await getI18n();
  const { token } = await params;
  const { error } = await searchParams;
  const errorKey = accountErrorFromQuery(error);
  const [session, invitation] = await Promise.all([
    auth(),
    prisma.workspaceInvitation.findUnique({
      where: { token },
      include: { workspace: { select: { name: true } } },
    }),
  ]);

  if (!invitation || invitation.status !== "PENDING") {
    notFound();
  }

  const expired = invitation.expiresAt <= new Date();
  const hasAccount = Boolean(
    await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } }),
  );

  async function createAccount(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    let email: string;
    try {
      ({ email } = await createInvitedUser({
        token,
        name: String(formData.get("name") ?? ""),
        password,
        confirm: String(formData.get("confirm") ?? ""),
      }));
    } catch (e) {
      if (e instanceof AccountError) redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
    try {
      await signIn(PASSWORD_PROVIDER_ID, { email, password, redirectTo: "/dashboard" });
    } catch (e) {
      if (e instanceof AuthError) redirect("/login");
      throw e;
    }
  }

  let body: React.ReactNode;
  if (expired) {
    body = <p className="text-sm text-error">{t("This invitation has expired. Ask the workspace owner to resend it.")}</p>;
  } else if (session?.user?.id) {
    body = <InvitationAcceptCard token={token} invitedEmail={invitation.email} />;
  } else if (hasAccount) {
    body = (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
        className="inline-flex w-full items-center justify-center rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white hover:bg-accent-hover"
      >
        {t("Sign in to accept")}
      </Link>
    );
  } else {
    body = (
      <form action={createAccount} className="space-y-5">
        <FormError message={errorKey ? t(errorKey) : null} />
        <Field id="email" label={t("Email")} type="email" dir="ltr" value={invitation.email} readOnly disabled />
        <Field id="name" label={t("Your name")} autoComplete="name" />
        <Field
          id="password"
          label={t("Password")}
          type="password"
          dir="ltr"
          required
          minLength={8}
          autoComplete="new-password"
          hint={t("At least 8 characters.")}
        />
        <Field id="confirm" label={t("Repeat password")} type="password" dir="ltr" required minLength={8} autoComplete="new-password" />
        <SubmitButton>{t("Create account and join")}</SubmitButton>
      </form>
    );
  }

  return (
    <AuthCard
      brand={t("Pasokh")}
      title={t("Join {workspace}", { workspace: invitation.workspace.name })}
      subtitle={t("You were invited as {role} for {email}.", { role: label(invitation.role), email: invitation.email })}
    >
      {body}
    </AuthCard>
  );
}
