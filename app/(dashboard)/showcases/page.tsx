"use client";

/** Showcase («ویترین»): product carousels kept in one place and shown by smart replies. */

import { handle } from "@/lib/text/handle";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import type { Card } from "@/lib/messages/outbound";

type ShowcaseRow = { id: string; name: string; instagramAccountId: string; cards: Card[] };

export default function ShowcasesPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [showcases, setShowcases] = useState<ShowcaseRow[] | null>(null);

  useEffect(() => {
    void fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => setAccounts(payload.data?.instagramAccounts ?? []));
  }, []);

  const load = useCallback(async () => {
    const qs = accountId === "all" ? "" : `?accountId=${encodeURIComponent(accountId)}`;
    const data = await (await fetch(`/api/showcases${qs}`)).json();
    setShowcases(data.showcases ?? []);
  }, [accountId]);

  useEffect(() => {
    // The state update happens after the fetch resolves.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void load();
  }, [load]);

  async function remove(showcase: ShowcaseRow) {
    if (!confirm(t("Delete the showcase “{name}”?", { name: showcase.name }))) return;
    const response = await fetch(`/api/showcases/${showcase.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const names = (data.usedBy ?? []).map((c: { name: string }) => c.name).join("، ");
      alert(`${data.error ? t(data.error as StaticMessageKey) : t("Could not delete it.")}${names ? `\n${names}` : ""}`);
      return;
    }
    await load();
  }

  const username = (id: string) => accounts.find((a) => a.id === id)?.username;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("Showcase")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("Product carousels sent in the DM: a photo, a title, a description and buttons per product. Build one here, then add it to any smart reply; change it here and every reply shows the new version.")}
          </p>
        </div>
        <Link href="/showcases/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
          + {t("New showcase")}
        </Link>
      </div>

      {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}

      {showcases === null ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : showcases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="font-medium">{t("No showcases yet")}</p>
          <p className="mt-2 text-sm text-muted">{t("A showcase can hold up to 10 products.")}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {showcases.map((s) => (
            <div key={s.id} className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <div>
                <p className="truncate font-semibold">{s.name}</p>
                {accounts.length > 1 && <p className="text-xs text-muted">{handle(username(s.instagramAccountId))}</p>}
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {s.cards.map((card, i) => (
                  <div key={i} className="w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
                    {card.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.imageUrl} alt="" className="h-16 w-full object-cover" />
                    ) : (
                      <div className="h-16 bg-surface-hover" />
                    )}
                    <p className="truncate px-1.5 py-1 text-[11px]">{card.title}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{t("{count} products", { count: s.cards.length })}</span>
                <div className="flex gap-3">
                  <Link href={`/showcases/${s.id}`} className="text-accent hover:underline">{t("Edit")}</Link>
                  <button type="button" onClick={() => void remove(s)} className="text-error hover:underline">{t("Delete")}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
