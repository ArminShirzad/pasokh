"use client";

/** Smart support («پشتیبان هوشمند»): follow-up messages sent with delays after a smart reply. */

import { handle } from "@/lib/text/handle";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";

type SequenceRow = {
  id: string;
  name: string;
  instagramAccountId: string;
  isActive: boolean;
  steps: { delayMinutes: number }[];
  enrollments: Record<string, number>;
};

export default function SequencesPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [sequences, setSequences] = useState<SequenceRow[] | null>(null);

  useEffect(() => {
    void fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => setAccounts(payload.data?.instagramAccounts ?? []));
  }, []);

  const load = useCallback(async () => {
    const qs = accountId === "all" ? "" : `?accountId=${encodeURIComponent(accountId)}`;
    const data = await (await fetch(`/api/sequences${qs}`)).json();
    setSequences(data.sequences ?? []);
  }, [accountId]);

  useEffect(() => {
    // The state update happens after the fetch resolves.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void load();
  }, [load]);

  async function toggle(sequence: SequenceRow) {
    setSequences((list) => list?.map((s) => (s.id === sequence.id ? { ...s, isActive: !s.isActive } : s)) ?? null);
    await fetch(`/api/sequences/${sequence.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !sequence.isActive }),
    });
  }

  async function remove(sequence: SequenceRow) {
    if (!confirm(t("Delete the sequence “{name}”? People part-way through it get nothing more.", { name: sequence.name }))) return;
    await fetch(`/api/sequences/${sequence.id}`, { method: "DELETE" });
    await load();
  }

  const username = (id: string) => accounts.find((a) => a.id === id)?.username;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("Smart support")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("Follow-up messages sent one after another, minutes or hours apart, to someone a smart reply answered. Start one from a smart reply's settings.")}
          </p>
        </div>
        <Link href="/sequences/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
          + {t("New sequence")}
        </Link>
      </div>

      {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}

      {sequences === null ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : sequences.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="font-medium">{t("No sequences yet")}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sequences.map((s) => (
            <div key={s.id} className={`space-y-3 rounded-xl border border-border bg-surface p-4 ${s.isActive ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.name}</p>
                  {accounts.length > 1 && <p className="text-xs text-muted">{handle(username(s.instagramAccountId))}</p>}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs">
                  <input type="checkbox" checked={s.isActive} onChange={() => void toggle(s)} />
                  {s.isActive ? t("Active") : t("Paused")}
                </label>
              </div>
              <p className="text-xs text-muted">
                {t("{count} steps", { count: s.steps.length })} ·{" "}
                {t("{active} in progress, {done} finished, {stopped} stopped", {
                  active: s.enrollments.ACTIVE ?? 0,
                  done: s.enrollments.DONE ?? 0,
                  stopped: (s.enrollments.STOPPED ?? 0) + (s.enrollments.FAILED ?? 0) + (s.enrollments.UNCONFIRMED ?? 0),
                })}
              </p>
              <div className="flex justify-end gap-3 text-xs">
                <Link href={`/sequences/${s.id}`} className="text-accent hover:underline">{t("Edit")}</Link>
                <button type="button" onClick={() => void remove(s)} className="text-error hover:underline">{t("Delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
