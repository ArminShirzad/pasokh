"use client";

/** SMS («پیامک هوشمند»): bulk SMS to contacts through an Iranian SMS panel. */

import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import { smsParts } from "@/lib/sms/providers";

type Provider = "KAVENEGAR" | "SMSIR" | "MELIPAYAMAK" | "TEST";
type Campaign = { id: string; name: string; message: string; provider: string; status: string; stopReason: string | null; createdAt: string; counts: Record<string, number> };

const PROVIDERS: [Provider, string][] = [
  ["KAVENEGAR", "Kavenegar (کاوه‌نگار)"],
  ["SMSIR", "sms.ir"],
  ["MELIPAYAMAK", "Melipayamak (ملی پیامک)"],
];
const KEY_HELP: Record<Exclude<Provider, "TEST">, StaticMessageKey> = {
  KAVENEGAR: "In the Kavenegar panel: Settings → API key.",
  SMSIR: "In the sms.ir panel: Developers → API keys.",
  MELIPAYAMAK: "In the Melipayamak console: the web service token (Console → API).",
};
const STATUS: Record<string, StaticMessageKey> = { QUEUED: "Queued", SENDING: "Sending", DONE: "Done", STOPPED: "Stopped" };

const control =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none";
const field = `w-full ${control}`;
const button = "rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50";

export default function SmsPage() {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<{ provider: Provider; sender: string; hasKey: boolean } | null | undefined>(undefined);
  const [provider, setProvider] = useState<Provider>("KAVENEGAR");
  const [sender, setSender] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [settingsMsg, setSettingsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    void fetch("/api/sms/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.settings);
        if (data.settings) {
          setProvider(data.settings.provider);
          setSender(data.settings.sender);
        }
      });
    void fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => setAccounts(payload.data?.instagramAccounts ?? []));
  }, []);

  const filterQuery = new URLSearchParams({ ...(accountId !== "all" ? { accountId } : {}), ...(tag ? { tag } : {}) }).toString();
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/sms/recipients?${filterQuery}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setCount(data.count ?? 0);
      });
    void fetch(`/api/contacts?${accountId !== "all" ? `accountId=${encodeURIComponent(accountId)}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setTags(data.tags ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [filterQuery, accountId]);

  const loadCampaigns = useCallback(async () => {
    const data = await (await fetch("/api/sms/campaigns")).json();
    setCampaigns(data.campaigns ?? []);
  }, []);
  useEffect(() => {
    // The state update happens after the fetch resolves.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void loadCampaigns();
  }, [loadCampaigns]);
  const sending = campaigns.some((c) => c.status === "QUEUED" || c.status === "SENDING");
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void loadCampaigns(), 3000);
    return () => clearInterval(timer);
  }, [sending, loadCampaigns]);

  async function saveSettings() {
    setSettingsMsg(null);
    const response = await fetch("/api/sms/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, sender, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
    });
    const data = await response.json();
    if (!response.ok) return setSettingsMsg({ ok: false, text: data.error ? t(data.error as StaticMessageKey) : t("Could not save.") });
    setSettings(data.settings);
    setApiKey("");
    setSettingsMsg({ ok: true, text: t("Saved.") });
  }

  async function sendTest() {
    setTestMsg(null);
    const response = await fetch("/api/sms/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: testPhone, message: t("Test message from Pasokh.") }),
    });
    const data = await response.json();
    setTestMsg(
      response.ok
        ? { ok: true, text: data.test ? t("Test mode: recorded, nothing was sent.") : t("Sent. Check the phone.") }
        : { ok: false, text: data.error ? t(data.error as StaticMessageKey) : t("The SMS was not sent.") }
    );
  }

  async function send() {
    if (!count) return;
    if (!confirm(t("Send this SMS to {count} numbers? This cannot be undone.", { count }))) return;
    setBusy(true);
    setSendMsg(null);
    try {
      const response = await fetch("/api/sms/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || message.slice(0, 40), message, accountId: accountId !== "all" ? accountId : null, tag: tag || null }),
      });
      const data = await response.json();
      if (!response.ok) return setSendMsg({ ok: false, text: data.error ? t(data.error as StaticMessageKey) : t("Could not start the send.") });
      setSendMsg({ ok: true, text: t("Sending started.") });
      setMessage("");
      setName("");
      await loadCampaigns();
    } finally {
      setBusy(false);
    }
  }

  async function stop(id: string) {
    if (!confirm(t("Stop this send? Numbers not yet sent will not get it."))) return;
    await fetch(`/api/sms/campaigns/${id}`, { method: "PATCH" });
    await loadCampaigns();
  }

  const parts = smsParts(message);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  if (settings === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("SMS")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("Send SMS to the phone numbers your contacts gave you, through your own SMS panel. Only message people who agreed to it; advertising lines add the opt-out text the regulator requires.")}
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold">{t("SMS panel")}</h2>
        <div className="flex flex-wrap gap-2">
          {[...PROVIDERS, ["TEST", t("Test mode (nothing is sent)")] as [Provider, string]].map(([p, label]) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`rounded-full border px-3 py-1 text-xs ${provider === p ? "border-accent bg-accent text-white" : "border-border"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {provider !== "TEST" && (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t("API key")}</span>
              <input
                className={field}
                dir="ltr"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings?.hasKey && settings.provider === provider ? t("Saved — leave empty to keep it") : ""}
              />
              <span className="text-xs text-muted">{t(KEY_HELP[provider])}</span>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t("Sender line")}</span>
              <input className={`${control} w-56`} dir="ltr" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="3000…" />
              {provider === "KAVENEGAR" && <span className="block text-xs text-muted">{t("Optional for Kavenegar: empty uses the panel's default line.")}</span>}
            </label>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white" onClick={() => void saveSettings()}>
            {t("Save")}
          </button>
          {settingsMsg && <p className={`text-sm ${settingsMsg.ok ? "text-success" : "text-error"}`}>{settingsMsg.text}</p>}
        </div>
        {settings && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <input className={`${control} w-48`} dir="ltr" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="09…" />
            <button type="button" className={button} disabled={!testPhone.trim()} onClick={() => void sendTest()}>
              {t("Send a test SMS")}
            </button>
            {testMsg && <p className={`text-sm ${testMsg.ok ? "text-success" : "text-error"}`}>{testMsg.text}</p>}
          </div>
        )}
      </section>

      {settings && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold">{t("New send")}</h2>
          <div className="flex flex-wrap items-end gap-3">
            {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} includeAll />}
            <select className={`${control} w-auto`} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">{t("All contacts with a phone")}</option>
              {tags.map((x) => (
                <option key={x} value={x}>#{x}</option>
              ))}
            </select>
            <span className="text-sm text-muted">{count === null ? "…" : t("{count} numbers", { count })}</span>
          </div>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Name (only you see it)")} />
          <textarea className={`${field} min-h-28`} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} placeholder={t("Write the SMS…")} />
          <p className="text-xs text-muted">
            {t("{chars} characters, {parts} SMS per number", { chars: parts.chars, parts: parts.parts })}
            {parts.unicode ? ` · ${t("Persian text: 70 characters per SMS, 67 when split.")}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !message.trim() || !count}
              onClick={() => void send()}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("Send")}
            </button>
            {sendMsg && <p className={`text-sm ${sendMsg.ok ? "text-success" : "text-error"}`}>{sendMsg.text}</p>}
          </div>
        </section>
      )}

      {campaigns.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{t("Sends")}</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {campaigns.map((c) => {
              const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
              return (
                <div key={c.id} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{c.name}</p>
                    <span className="text-xs text-muted">
                      {date(c.createdAt)} · {t(STATUS[c.status] ?? "Queued")}
                      {c.provider === "TEST" ? ` · ${t("test mode")}` : ""}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-muted">{c.message}</p>
                  <p className="text-xs">
                    {t("{sent} of {total} sent, {failed} failed, {unclear} unclear", {
                      sent: c.counts.SENT ?? 0,
                      total,
                      failed: c.counts.FAILED ?? 0,
                      unclear: c.counts.UNCONFIRMED ?? 0,
                    })}
                  </p>
                  {c.stopReason && <p className="text-xs text-error">{t(c.stopReason as StaticMessageKey)}</p>}
                  {(c.status === "QUEUED" || c.status === "SENDING") && (
                    <button type="button" className="text-xs text-error hover:underline" onClick={() => void stop(c.id)}>
                      {t("Stop")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
