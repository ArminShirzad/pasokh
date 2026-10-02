"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useState } from "react";

interface InvitationAcceptCardProps {
  token: string;
  invitedEmail: string;
}

/** Shown to a signed-in user; signed-out invitees get a password form instead. */
export default function InvitationAcceptCard({ token, invitedEmail }: InvitationAcceptCardProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function acceptInvite() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/workspace/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json();
    if (payload.success) {
      window.location.assign("/dashboard");
      return;
    }
    setMessage(payload.error ?? t("Could not accept invitation"));
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={acceptInvite}
        disabled={busy}
        className="inline-flex w-full items-center justify-center rounded bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? t("Accepting...") : t("Accept invitation")}
      </button>
      {message && <p className="text-sm text-error">{message}</p>}
      <p className="text-xs text-muted">
        {t("Accept while signed in as {email}.", { email: invitedEmail })}
      </p>
    </div>
  );
}
