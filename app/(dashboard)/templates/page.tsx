"use client";

/** Templates («الگوها»): ready-made setups, created paused for review. */

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";

type Key = "city-menu" | "price-showcase" | "signup-form" | "follow-up" | "comment-giveaway";
type Created = { kind: string; id: string; name: string; href: string };

const TEMPLATES: { key: Key; title: StaticMessageKey; body: StaticMessageKey; uses: StaticMessageKey }[] = [
  {
    key: "city-menu",
    title: "Branches menu",
    body: "Someone sends “branch”; they get quick-reply buttons for each city, and each button answers with that branch's address and hours.",
    uses: "Smart reply with a menu",
  },
  {
    key: "price-showcase",
    title: "Price list as a carousel",
    body: "Someone sends “price”; they get a swipeable row of products with photos, prices and a buy button. Edit the products once in Showcase.",
    uses: "Showcase + smart reply",
  },
  {
    key: "signup-form",
    title: "Sign-up in the DM",
    body: "Someone sends “sign up”; the DM asks their name, mobile number and preferred time, checks the number, and saves it on the contact.",
    uses: "Form + smart reply",
  },
  {
    key: "follow-up",
    title: "Follow-up after a question",
    body: "Someone asks about a consultation; an hour later, and again the next day, a follow-up message, unless they have already replied.",
    uses: "Smart support + smart reply",
  },
  {
    key: "comment-giveaway",
    title: "Comment giveaway",
    body: "Anyone who comments “join” under any post gets a DM once they follow you, and a public reply from three different wordings.",
    uses: "Campaign with follow gate",
  },
];

const KIND_LABEL: Record<string, StaticMessageKey> = {
  command: "Smart reply",
  showcase: "Showcase",
  form: "Forms",
  sequence: "Smart support",
  campaign: "Campaigns",
};

export default function TemplatesPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState<Key | null>(null);
  const [result, setResult] = useState<{ key: Key; created: Created[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        const list: AccountOption[] = payload.data?.instagramAccounts ?? [];
        setAccounts(list);
        setAccountId((prev) => prev || payload.data?.selectedInstagramAccountId || list[0]?.id || "");
      });
  }, []);

  async function use(key: Key) {
    setBusy(key);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, instagramAccountId: accountId }),
      });
      const data = await response.json();
      if (!response.ok) return setError(data.error ? t(data.error as StaticMessageKey) : t("Could not save."));
      setResult({ key, created: data.created });
    } finally {
      setBusy(null);
    }
  }

  if (accounts && accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        {t("Connect an Instagram account first, or open the test lab to get a test account.")}{" "}
        <Link href="/simulator" className="text-accent underline">{t("Test lab")}</Link>
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("Templates")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("Ready-made setups to start from. Each is created paused, so nothing answers your followers until you have read it, changed the wording to yours and switched it on. Try them in the test lab first.")}
        </p>
      </div>

      {accounts && accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {TEMPLATES.map((tpl) => (
          <div key={tpl.key} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div>
              <p className="font-semibold">{t(tpl.title)}</p>
              <p className="text-xs text-accent">{t(tpl.uses)}</p>
            </div>
            <p className="flex-1 text-sm text-muted">{t(tpl.body)}</p>
            {result?.key === tpl.key ? (
              <div className="space-y-1 rounded-lg bg-success/10 p-3 text-sm">
                <p className="text-success">{t("Created, paused. Review and switch on:")}</p>
                {result.created.map((c) => (
                  <Link key={c.id} href={c.href} className="block text-accent hover:underline">
                    {t(KIND_LABEL[c.kind] ?? "Edit")}: {c.name}
                  </Link>
                ))}
              </div>
            ) : (
              <button
                type="button"
                disabled={busy !== null || !accountId}
                onClick={() => void use(tpl.key)}
                className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === tpl.key ? t("Creating…") : t("Use this template")}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
