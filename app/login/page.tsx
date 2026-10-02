import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import AuthCard, { Field, FormError, SubmitButton } from "@/components/auth-card";
import { EMAIL_PROVIDER_ID, PASSWORD_PROVIDER_ID, auth, isEmailLoginEnabled, signIn } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import { needsFirstRunSetup } from "@/lib/users/accounts";
import { safeCallbackUrl } from "@/lib/users/redirect";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return {
    title: t("Login - Pasokh"),
    description: t("Sign in to manage Instagram comment-to-DM campaigns."),
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkEmail?: string;
    callbackUrl?: string;
    template?: string;
    error?: string;
    code?: string;
  }>;
}) {
  // A fresh install has no accounts yet; the owner is created on /setup.
  if (await needsFirstRunSetup()) redirect("/setup");

  const { t } = await getI18n();
  const params = await searchParams;
  const checkEmail = params.checkEmail === "1";
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate ? `/campaigns/new?template=${selectedTemplate.slug}` : null;
  const callbackUrl = safeCallbackUrl(params.callbackUrl) ?? templateCallbackUrl ?? "/dashboard";
  const emailLogin = isEmailLoginEnabled();

  // Already signed in with a session the server can read: go on. (An
  // unreadable cookie yields no session here, so the form shows instead of a
  // redirect loop.)
  if ((await auth())?.user?.id) redirect(callbackUrl);

  const errorMessage =
    params.code === "throttled"
      ? t("Too many failed attempts. Wait 15 minutes and try again.")
      : params.error
        ? t("Wrong email or password.")
        : null;

  async function signInWithPassword(formData: FormData) {
    "use server";
    try {
      await signIn(PASSWORD_PROVIDER_ID, {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: callbackUrl,
      });
    } catch (e) {
      if (e instanceof AuthError) {
        const code = "code" in e && typeof e.code === "string" ? e.code : "credentials";
        const back = new URLSearchParams({ error: "CredentialsSignin", code });
        if (params.callbackUrl) back.set("callbackUrl", callbackUrl);
        redirect(`/login?${back}`);
      }
      throw e;
    }
  }

  async function sendMagicLink(formData: FormData) {
    "use server";
    await signIn(EMAIL_PROVIDER_ID, {
      email: String(formData.get("email") ?? ""),
      redirectTo: callbackUrl,
    });
  }

  if (checkEmail) {
    return (
      <AuthCard brand={t("Pasokh")}>
        <div className="py-4 text-center">
          <h2 className="mb-2 text-lg font-semibold">{t("Check your email")}</h2>
          <p className="text-sm text-muted">{t("We sent you a secure sign-in link. Open it on this device to continue.")}</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      brand={t("Pasokh")}
      subtitle={
        selectedTemplate
          ? t("Sign in to use the {name} template.", { name: selectedTemplate.title })
          : t("Sign in to manage Instagram comment-to-DM campaigns.")
      }
    >
      <form action={signInWithPassword} className="space-y-5">
        <FormError message={errorMessage} />
        <Field id="email" label={t("Email")} type="email" dir="ltr" required autoComplete="email" />
        <Field id="password" label={t("Password")} type="password" dir="ltr" required autoComplete="current-password" />
        <SubmitButton>{t("Sign in")}</SubmitButton>
      </form>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        {t("Forgot your password? Run this on the server:")}{" "}
        <code dir="ltr" className="block mt-1 overflow-x-auto whitespace-nowrap rounded bg-background px-2 py-1">
          docker compose exec web npm run user:password -- you@example.com
        </code>
      </p>

      {emailLogin && (
        <form action={sendMagicLink} className="mt-8 space-y-4 border-t border-border pt-6">
          <p className="text-sm text-muted">{t("Or get a one-time sign-in link by email.")}</p>
          <Field id="magic-email" label={t("Email")} name="email" type="email" dir="ltr" required autoComplete="email" />
          <button
            type="submit"
            className="w-full rounded border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground hover:bg-surface-hover"
          >
            {t("Email me a magic link")}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
