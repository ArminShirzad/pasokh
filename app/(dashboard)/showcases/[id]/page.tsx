"use client";

import { handle } from "@/lib/text/handle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { CardsEditor, type CommandSummary } from "@/components/command-editor";
import MessagePreview from "@/components/message-preview";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import type { Card } from "@/lib/messages/outbound";

type Account = { id: string; username: string };
type Draft = { name: string; instagramAccountId: string; cards: Card[] };
type Problem = { path: string; message: string };

const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none";

export default function ShowcaseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [usedBy, setUsedBy] = useState<{ id: string; name: string }[]>([]);
  const [commands, setCommands] = useState<CommandSummary[]>([]);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stats = await (await fetch("/api/dashboard/stats")).json();
      const list: Account[] = stats.data?.instagramAccounts ?? [];
      if (cancelled) return;
      setAccounts(list);
      if (isNew) {
        if (list.length) setDraft({ name: "", instagramAccountId: list[0].id, cards: [{ title: "" }] });
        return;
      }
      const response = await fetch(`/api/showcases/${encodeURIComponent(id)}`);
      if (!response.ok) {
        if (!cancelled) setMissing(true);
        return;
      }
      const data = await response.json();
      if (cancelled) return;
      setDraft({ name: data.showcase.name, instagramAccountId: data.showcase.instagramAccountId, cards: data.showcase.cards });
      setUsedBy(data.usedBy ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const accountId = draft?.instagramAccountId;
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void fetch(`/api/commands?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setCommands(data.commands ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setProblems([]);
    setError(null);
    try {
      const response = await fetch(isNew ? "/api/showcases" : `/api/showcases/${id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) {
        setProblems(data.problems ?? []);
        setError(
          data.problems?.length
            ? t("Fix the highlighted problems and save again.")
            : data.error
              ? t(data.error as StaticMessageKey)
              : t("Could not save the showcase.")
        );
        return;
      }
      router.push("/showcases");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const problemsFor = (index: number) => problems.filter((p) => p.path.startsWith(`cards[${index}]`));
  const general = problems.filter((p) => !/^cards\[\d+\]/.test(p.path));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/showcases" className="text-sm text-muted hover:text-foreground">
          <span className="inline-block rtl:rotate-180">←</span> {t("Showcase")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{isNew ? t("New showcase") : t("Edit showcase")}</h1>
      </div>
      {missing ? (
        <p className="text-sm text-error">{t("Showcase not found.")}</p>
      ) : accounts && accounts.length === 0 ? (
        <p className="text-sm text-muted">
          {t("Connect an Instagram account first, or open the test lab to get a test account.")}{" "}
          <Link href="/simulator" className="text-accent underline">{t("Test lab")}</Link>
        </p>
      ) : !draft || !accounts ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t("Showcase name")}</span>
                <input className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("e.g. Autumn collection")} />
                <span className="text-xs text-muted">{t("Only you see this name.")}</span>
              </label>
              {accounts.length > 1 && (
                <label className="block space-y-1">
                  <span className="text-sm font-medium">{t("Instagram account")}</span>
                  <select className={field} value={draft.instagramAccountId} disabled={!isNew} onChange={(e) => setDraft({ ...draft, instagramAccountId: e.target.value })}>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{handle(a.username)}</option>
                    ))}
                  </select>
                </label>
              )}
              {usedBy.length > 0 && (
                <p className="text-xs text-muted">{t("Shown by: {names}", { names: usedBy.map((c) => c.name).join("، ") })}</p>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="font-semibold">{t("Products")}</h2>
              <p className="text-xs text-muted">
                {t("Square photos (JPEG or PNG) look best. Titles and descriptions can be up to 80 characters; each product can have up to 3 buttons.")}
              </p>
              <CardsEditor cards={draft.cards} commands={commands} problemsFor={problemsFor} onChange={(cards) => setDraft({ ...draft, cards })} />
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? t("Saving…") : t("Save showcase")}
              </button>
              {error && <p className="text-sm text-error">{error}</p>}
              {general.map((p, i) => (
                <p key={i} className="text-sm text-error">{t(p.message as StaticMessageKey)}</p>
              ))}
            </div>
          </div>

          <aside className="xl:sticky xl:top-4 xl:self-start">
            <div className="rounded-[2rem] border-4 border-zinc-800 bg-background p-3 shadow-lg">
              <p className="mb-3 text-center text-xs text-muted">{t("Preview")}</p>
              <div className="rounded-2xl rounded-es-md bg-surface p-2">
                <MessagePreview message={{ type: "cards", cards: draft.cards }} />
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
