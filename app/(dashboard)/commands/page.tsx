"use client";

/** Smart reply («پاسخ هوشمند»): the list of commands, with on/off and search. */

import { handle } from "@/lib/text/handle";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import type { OutboundMessage } from "@/lib/messages/outbound";

type CommandRow = {
  id: string;
  name: string;
  instagramAccountId: string;
  isActive: boolean;
  matchMode: string;
  keywords: string[];
  storyScope: string;
  onStoryMention: boolean;
  responses: OutboundMessage[];
  runs: number;
};

function firstText(responses: OutboundMessage[]): string {
  for (const r of responses) {
    if (r.type === "text") return r.text;
    if (r.type === "cards") return r.cards.map((c) => c.title).join(" · ");
  }
  return "";
}

export default function CommandsPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [commands, setCommands] = useState<CommandRow[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => setAccounts(payload.data?.instagramAccounts ?? []));
  }, []);

  const load = useCallback(async () => {
    const qs = accountId === "all" ? "" : `?accountId=${encodeURIComponent(accountId)}`;
    const data = await (await fetch(`/api/commands${qs}`)).json();
    setCommands(data.commands ?? []);
  }, [accountId]);

  useEffect(() => {
    // The state update happens after the fetch resolves.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!commands || !q) return commands ?? [];
    return commands.filter(
      (c) => c.name.toLowerCase().includes(q) || c.keywords.some((k) => k.toLowerCase().includes(q)) || firstText(c.responses).toLowerCase().includes(q)
    );
  }, [commands, query]);

  async function toggle(command: CommandRow) {
    setCommands((list) => list?.map((c) => (c.id === command.id ? { ...c, isActive: !c.isActive } : c)) ?? null);
    await fetch(`/api/commands/${command.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !command.isActive }),
    });
  }

  async function remove(command: CommandRow) {
    if (!confirm(t("Delete the command “{name}”? Buttons in other commands that open it will stop working.", { name: command.name }))) return;
    await fetch(`/api/commands/${command.id}`, { method: "DELETE" });
    await load();
  }

  const username = (id: string) => accounts.find((a) => a.id === id)?.username;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("Smart reply")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("Automatic answers to DMs, story replies and story mentions. Quick replies in an answer can open other commands, so you can build menus.")}
          </p>
        </div>
        <Link href="/commands/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
          + {t("New command")}
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search commands…")}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>

      {commands === null ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="font-medium">{commands.length ? t("No commands match your search.") : t("No commands yet")}</p>
          {!commands.length && (
            <p className="mt-2 text-sm text-muted">{t("Create one, then try it in the test lab before your followers do.")}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((c) => (
            <div key={c.id} className={`space-y-3 rounded-xl border border-border bg-surface p-4 ${c.isActive ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  {accounts.length > 1 && <p className="text-xs text-muted">{handle(username(c.instagramAccountId))}</p>}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs">
                  <input type="checkbox" checked={c.isActive} onChange={() => void toggle(c)} />
                  {c.isActive ? t("Active") : t("Paused")}
                </label>
              </div>
              <div className="flex flex-wrap gap-1">
                {c.keywords.slice(0, 8).map((k) => (
                  <span key={k} className="rounded-full bg-background px-2 py-0.5 text-xs">{k}</span>
                ))}
                {c.storyScope !== "ALL" && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                    {c.storyScope === "SPECIFIC" ? t("Specific stories") : t("Story replies")}
                  </span>
                )}
                {c.keywords.length === 0 && c.storyScope === "ALL" && !c.onStoryMention && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">{t("Menu only")}</span>
                )}
                {c.onStoryMention && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">{t("Story mentions")}</span>}
              </div>
              <p className="line-clamp-2 text-sm text-muted">{firstText(c.responses)}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{t("Answered {count} times", { count: c.runs })}</span>
                <div className="flex gap-3">
                  <Link href={`/commands/${c.id}`} className="text-accent hover:underline">{t("Edit")}</Link>
                  <button type="button" onClick={() => void remove(c)} className="text-error hover:underline">{t("Delete")}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
