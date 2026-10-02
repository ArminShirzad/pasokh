"use client";

/**
 * Welcome questions («پیام خوش‌آمدگویی»): Instagram's ice breakers. Up to 4
 * questions shown to someone opening a chat with the account for the first
 * time; tapping one runs a smart reply.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";

type Item = { question: string; commandId: string };
type CommandOption = { id: string; name: string; isActive: boolean };
type SyncState = { syncedAt: string | null; error: string | null };

const MAX = 4;
const QUESTION_MAX = 80;
const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none";

export default function WelcomePage() {
  const { t, locale } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [commands, setCommands] = useState<CommandOption[]>([]);
  const [sync, setSync] = useState<SyncState>({ syncedAt: null, error: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        const list: AccountOption[] = payload.data?.instagramAccounts ?? [];
        setAccounts(list);
        setAccountId((prev) => prev || payload.data?.selectedInstagramAccountId || list[0]?.id || "");
      });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/ice-breakers?accountId=${encodeURIComponent(accountId)}`).then((r) => r.json()),
      fetch(`/api/commands?accountId=${encodeURIComponent(accountId)}`).then((r) => r.json()),
    ]).then(([state, list]) => {
      if (cancelled) return;
      setItems((state.items ?? []).map((i: Item) => ({ question: i.question, commandId: i.commandId })));
      setSync({ syncedAt: state.syncedAt ?? null, error: state.error ?? null });
      setCommands(list.commands ?? []);
      setSaved(false);
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  async function save() {
    if (!items) return;
    const clean = items.map((i) => ({ question: i.question.trim(), commandId: i.commandId })).filter((i) => i.question || i.commandId);
    if (clean.some((i) => !i.question)) return setError(t("Write a question for every row."));
    if (clean.some((i) => !i.commandId)) return setError(t("Choose a smart reply of this account for every question."));
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/ice-breakers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId: accountId, items: clean }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ? t(data.error as StaticMessageKey) : t("Could not save."));
        return;
      }
      setItems(clean);
      setSync({ syncedAt: data.syncedAt ?? null, error: data.error ?? null });
      setSaved(data.pushed);
    } finally {
      setSaving(false);
    }
  }

  const update = (index: number, next: Item) => setItems((list) => list?.map((x, i) => (i === index ? next : x)) ?? null);
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  if (accounts && accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        {t("Connect an Instagram account first, or open the test lab to get a test account.")}{" "}
        <Link href="/simulator" className="text-accent underline">{t("Test lab")}</Link>
      </p>
    );
  }

  const shown = (items ?? []).filter((i) => i.question.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("Welcome message")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("Up to 4 questions Instagram shows to someone opening a chat with you for the first time. Tapping one sends the smart reply you pick for it. Instagram shows them in the app, not on desktop.")}
        </p>
      </div>

      {accounts && accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}

      {items === null ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            {commands.length === 0 && (
              <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
                {t("Each question opens a smart reply, and this account has none yet.")}{" "}
                <Link href="/commands/new" className="underline">{t("New command")}</Link>
              </p>
            )}
            {items.map((item, index) => {
              const target = commands.find((c) => c.id === item.commandId);
              return (
                <div key={index} className="space-y-2 rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{t("Question {number}", { number: index + 1 })}</p>
                    <button type="button" className="text-xs text-error" onClick={() => setItems(items.filter((_, i) => i !== index))}>
                      {t("Remove")}
                    </button>
                  </div>
                  <input
                    className={field}
                    value={item.question}
                    maxLength={QUESTION_MAX}
                    placeholder={t("e.g. How much is shipping?")}
                    onChange={(e) => update(index, { ...item, question: e.target.value })}
                  />
                  <select className={field} value={item.commandId} onChange={(e) => update(index, { ...item, commandId: e.target.value })}>
                    <option value="">{t("Choose a smart reply…")}</option>
                    {commands.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.isActive ? c.name : `${c.name} (${t("Paused")})`}
                      </option>
                    ))}
                  </select>
                  {target && !target.isActive && (
                    <p className="text-xs text-error">{t("This smart reply is paused, so tapping the question does nothing.")}</p>
                  )}
                </div>
              );
            })}
            {items.length < MAX && (
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover"
                onClick={() => setItems([...items, { question: "", commandId: "" }])}
              >
                + {t("Add question")}
              </button>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? t("Saving…") : t("Save and send to Instagram")}
              </button>
              {error && <p className="text-sm text-error">{error}</p>}
              {saved && <p className="text-sm text-success">{t("Saved. Instagram now shows these questions.")}</p>}
            </div>
            {sync.error ? (
              <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">
                {t("Saved here, but Instagram refused the update, so it still shows the previous questions. Save again to retry.")}
                <span className="mt-1 block font-mono text-[11px] opacity-80" dir="ltr">{sync.error}</span>
              </p>
            ) : sync.syncedAt ? (
              <p className="text-xs text-muted">{t("Last sent to Instagram: {date}", { date: formatDate(sync.syncedAt) })}</p>
            ) : null}
          </div>

          <aside className="xl:sticky xl:top-4 xl:self-start">
            <div className="rounded-[2rem] border-4 border-zinc-800 bg-background p-4 shadow-lg">
              <p className="mb-3 text-center text-xs text-muted">{t("A new chat with you")}</p>
              {shown.length === 0 ? (
                <p className="py-10 text-center text-xs text-muted">{t("No questions: the chat opens empty.")}</p>
              ) : (
                <div className="space-y-2 py-6">
                  {shown.map((item, i) => (
                    <div key={i} className="rounded-full border border-border px-4 py-2 text-center text-sm text-foreground">
                      {item.question}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
