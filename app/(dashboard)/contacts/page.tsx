"use client";

/** Contacts («مخاطبان»): everyone who messaged or commented, with tags, phone and email. */

import { handle } from "@/lib/text/handle";
import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";

type Contact = {
  id: string;
  igsid: string;
  username: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  firstSeenAt: string;
  lastInboundAt: string | null;
};

const WINDOW_MS = 24 * 60 * 60 * 1000;
const control =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none";

export default function ContactsPage() {
  const { t, locale } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; rows: Contact[]; tags: string[]; pageSize: number } | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    void fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => setAccounts(payload.data?.instagramAccounts ?? []));
  }, []);

  const params = new URLSearchParams({
    ...(accountId !== "all" ? { accountId } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(tag ? { tag } : {}),
    ...(hasPhone ? { hasPhone: "1" } : {}),
  }).toString();

  const load = useCallback(async () => {
    const response = await fetch(`/api/contacts?${params}&page=${page}`);
    setData(await response.json());
  }, [params, page]);

  useEffect(() => {
    // The state update happens after the fetch resolves.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void load();
  }, [load]);

  async function save() {
    if (!editing) return;
    setEditError(null);
    const response = await fetch(`/api/contacts/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, phone: editing.phone, email: editing.email, tags: editing.tags }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setEditError(body.error ? t(body.error as StaticMessageKey) : t("Could not save."));
      return;
    }
    setEditing(null);
    await load();
  }

  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)) : "—");
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("Contacts")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("Everyone who messaged or commented. Phone numbers and emails come from form answers or your edits; tags are yours to group people by.")}
          </p>
        </div>
        <a href={`/api/contacts/export?${params}`} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
          {t("Download for Excel (CSV)")}
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={(v) => { setAccountId(v); setPage(1); }} />}
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t("Search username, name, phone…")} className={`${control} min-w-0 flex-1`} />
        {data && data.tags.length > 0 && (
          <select className={`${control} w-auto`} value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }}>
            <option value="">{t("All tags")}</option>
            {data.tags.map((x) => (
              <option key={x} value={x}>#{x}</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hasPhone} onChange={(e) => { setHasPhone(e.target.checked); setPage(1); }} />
          {t("With phone number")}
        </label>
      </div>

      {!data ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : data.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">{t("No contacts match.")}</div>
      ) : (
        <>
          <p className="text-xs text-muted">{t("{count} contacts", { count: data.total })}</p>
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {data.rows.map((c) => {
              const open = c.lastInboundAt && now - new Date(c.lastInboundAt).getTime() < WINDOW_MS;
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {c.username ? handle(c.username) : c.igsid.slice(-8)}
                      {c.name && <span className="ms-2 font-normal text-muted">{c.name}</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {c.phone && <span dir="ltr" className="me-3">{c.phone}</span>}
                      {c.email && <span dir="ltr" className="me-3">{c.email}</span>}
                      {t("Last message: {date}", { date: date(c.lastInboundAt) })}
                    </p>
                    {c.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.tags.map((x) => (
                          <span key={x} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">#{x}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {open && <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">{t("Can be messaged now")}</span>}
                  <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setEditError(null); setEditing(c); }}>
                    {t("Edit")}
                  </button>
                </div>
              );
            })}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-30">{t("Previous")}</button>
              <span className="text-muted">{t("Page {page} of {pages}", { page, pages })}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="disabled:opacity-30">{t("Next")}</button>
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md space-y-3 rounded-xl bg-background p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold">{editing.username ? handle(editing.username) : editing.igsid}</p>
            <input className={`${control} w-full`} placeholder={t("Name")} value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className={`${control} w-full`} dir="ltr" placeholder={t("Phone")} value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            <input className={`${control} w-full`} dir="ltr" placeholder={t("Email")} value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            <input
              className={`${control} w-full`}
              placeholder={t("Tags, separated by commas")}
              defaultValue={editing.tags.join("، ")}
              onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean) })}
            />
            {editError && <p className="text-xs text-error">{editError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => setEditing(null)}>{t("Cancel")}</button>
              <button type="button" className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white" onClick={() => void save()}>{t("Save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
