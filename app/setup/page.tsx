import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import AuthCard, { Field, FormError, SubmitButton } from "@/components/auth-card";
import { PASSWORD_PROVIDER_ID, signIn } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { AccountError, accountErrorFromQuery, createFirstOwner, needsFirstRunSetup } from "@/lib/users/accounts";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: `${t("Set up Pasokh")} - ${t("Pasokh")}` };
}

/**
 * First run: the only way into a fresh instance. Creates the owner account and
 * workspace, then closes for good: once any user exists this page redirects
 * to /login, and createFirstOwner re-checks under a lock.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await needsFirstRunSetup())) redirect("/login");
  const { t } = await getI18n();
  const { error } = await searchParams;
  const errorKey = accountErrorFromQuery(error);

  async function completeSetup(formData: FormData) {
    "use server";
    const field = (name: string) => String(formData.get(name) ?? "");
    try {
      await createFirstOwner({
        name: field("name"),
        email: field("email"),
        password: field("password"),
        confirm: field("confirm"),
        workspaceName: field("workspace"),
      });
    } catch (e) {
      if (e instanceof AccountError) redirect(`/setup?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
    try {
      await signIn(PASSWORD_PROVIDER_ID, {
        email: field("email"),
        password: field("password"),
        redirectTo: "/dashboard",
      });
    } catch (e) {
      // The account exists now; if the automatic sign-in fails, the login
      // page is the right place to retry.
      if (e instanceof AuthError) redirect("/login");
      throw e;
    }
  }

  return (
    <AuthCard
      brand={t("Pasokh")}
      title={t("Set up Pasokh")}
      subtitle={t("Create the owner account for this server. You will use this email and password to sign in.")}
    >
      <form action={completeSetup} className="space-y-5">
        <FormError message={errorKey ? t(errorKey) : null} />
        <Field id="name" label={t("Your name")} autoComplete="name" />
        <Field id="workspace" label={t("Business or page name")} placeholder={t("e.g. My Shop")} />
        <Field id="email" label={t("Email")} type="email" dir="ltr" required autoComplete="email" />
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
        <SubmitButton>{t("Create account and continue")}</SubmitButton>
      </form>
    </AuthCard>
  );
}
