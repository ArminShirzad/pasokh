"use client";

/** Form builder («فرم‌ساز»): questions asked one at a time in the DM. */

import { handle } from "@/lib/text/handle";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";

type FormRow = {
  id: string;
  name: string;
  instagramAccountId: string;
  isActive: boolean;
  questions: unknown[];
  submissions: Record<string, number>;
};

export default function FormsPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [forms, setForms] = useState<FormRow[] | null>(null);

  useEffect(() => {
    void fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => setAccounts(payload.data?.instagramAccounts ?? []));
  }, []);

  const load = useCallback(async () => {
    const qs = accountId === "all" ? "" : `?accountId=${encodeURIComponent(accountId)}`;
    const data = await (await fetch(`/api/forms${qs}`)).json();
    setForms(data.forms ?? []);
  }, [accountId]);

  useEffect(() => {
    // The state update happens after the fetch resolves.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void load();
  }, [load]);

  async function toggle(form: FormRow) {
    setForms((list) => list?.map((f) => (f.id === form.id ? { ...f, isActive: !f.isActive } : f)) ?? null);
    await fetch(`/api/forms/${form.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !form.isActive }),
    });
  }

  async function remove(form: FormRow) {
    if (!confirm(t("Delete the form “{name}” and all its answers?", { name: form.name }))) return;
    await fetch(`/api/forms/${form.id}`, { method: "DELETE" });
    await load();
  }

  const username = (id: string) => accounts.find((a) => a.id === id)?.username;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("Forms")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("Questions asked one at a time in the DM: name, phone number, a choice of options. Start a form from a smart reply; the answers are collected here and can be downloaded for Excel.")}
          </p>
        </div>
        <Link href="/forms/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
          + {t("New form")}
        </Link>
      </div>

      {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}

      {forms === null ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : forms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="font-medium">{t("No forms yet")}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {forms.map((f) => (
            <div key={f.id} className={`space-y-3 rounded-xl border border-border bg-surface p-4 ${f.isActive ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{f.name}</p>
                  {accounts.length > 1 && <p className="text-xs text-muted">{handle(username(f.instagramAccountId))}</p>}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs">
                  <input type="checkbox" checked={f.isActive} onChange={() => void toggle(f)} />
                  {f.isActive ? t("Active") : t("Paused")}
                </label>
              </div>
              <p className="text-xs text-muted">
                {t("{count} questions", { count: f.questions.length })} ·{" "}
                {t("{completed} completed, {open} in progress", { completed: f.submissions.COMPLETED ?? 0, open: f.submissions.IN_PROGRESS ?? 0 })}
              </p>
              <div className="flex justify-end gap-3 text-xs">
                <Link href={`/forms/${f.id}/results`} className="text-accent hover:underline">{t("Results")}</Link>
                <Link href={`/forms/${f.id}`} className="text-accent hover:underline">{t("Edit")}</Link>
                <button type="button" onClick={() => void remove(f)} className="text-error hover:underline">{t("Delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
