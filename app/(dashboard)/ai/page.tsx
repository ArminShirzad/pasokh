"use client";

/** AI assistant («هوش مصنوعی»): answers the DMs nothing else answered. */

import { useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import { ANTHROPIC_MODELS } from "@/lib/ai/llm";

type Settings = {
  enabled: boolean;
  provider: "ANTHROPIC" | "OPENAI";
  model: string;
  baseUrl: string | null;
  persona: string;
  tone: number;
  knowledge: string;
  dailyLimitPerPerson: number;
};
type Recent = { id: string; question: string; answer: string | null; status: string; error: string | null; createdAt: string };

const KNOWLEDGE_MAX = 20_000;
const control =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none";
const field = `w-full ${control}`;
const DEFAULTS: Settings = {
  enabled: false,
  provider: "ANTHROPIC",
  model: ANTHROPIC_MODELS[0],
  baseUrl: null,
  persona: "",
  tone: 2,
  knowledge: "",
  dailyLimitPerPerson: 20,
};
const TONE_LABELS: StaticMessageKey[] = ["Formal", "Polite", "Friendly", "Playful"];

export default function AiPage() {
  const { t, locale } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [trial, setTrial] = useState<{ ok: boolean; text: string } | null>(null);
  const [trying, setTrying] = useState(false);

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
    void fetch(`/api/ai?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSettings(data.assistant ? { ...DEFAULTS, ...data.assistant } : DEFAULTS);
        setHasKey(Boolean(data.assistant?.hasKey));
        setRecent(data.recent ?? []);
        setApiKey("");
        setMessage(null);
        setTrial(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (accounts && accounts.length === 0) return <p className="text-sm text-muted">{t("Connect an Instagram account first.")}</p>;
  if (!settings) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, instagramAccountId: accountId, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ ok: false, text: data.error ? t(data.error as StaticMessageKey) : t("Could not save.") });
        return;
      }
      setHasKey(true);
      setApiKey("");
      setRecent(data.recent ?? []);
      setMessage({ ok: true, text: settings.enabled ? t("Saved. The assistant now answers DMs nothing else answers.") : t("Saved. The assistant is off.") });
    } finally {
      setSaving(false);
    }
  }

  async function tryIt() {
    setTrying(true);
    setTrial(null);
    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId: accountId, question }),
      });
      const data = await response.json();
      setTrial(response.ok ? { ok: true, text: data.answer } : { ok: false, text: data.error ? t(data.error as StaticMessageKey) : t("The AI request failed.") });
    } finally {
      setTrying(false);
    }
  }

  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("AI assistant")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("Answers DMs that no form, smart reply or campaign answered, from what you write below. It is told not to make up prices or facts, and to say a person will follow up when it does not know.")}
        </p>
      </div>

      {accounts && accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}

      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={settings.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          {t("Answer DMs with AI")}
        </label>

        <div className="flex flex-wrap gap-2">
          {(["ANTHROPIC", "OPENAI"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSettings({ ...settings, provider: p, model: p === "ANTHROPIC" ? ANTHROPIC_MODELS[0] : "", baseUrl: p === "OPENAI" ? settings.baseUrl ?? "https://api.openai.com/v1" : null })}
              className={`rounded-full border px-3 py-1 text-xs ${settings.provider === p ? "border-accent bg-accent text-white" : "border-border"}`}
            >
              {p === "ANTHROPIC" ? "Claude (Anthropic)" : t("OpenAI-compatible")}
            </button>
          ))}
        </div>

        {settings.provider === "OPENAI" && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("API address")}</span>
            <input className={field} dir="ltr" value={settings.baseUrl ?? ""} onChange={(e) => set("baseUrl", e.target.value)} placeholder="https://api.openai.com/v1" />
            <span className="text-xs text-muted">{t("Any service that speaks the OpenAI chat API, including Iranian gateways: paste the address they give you, ending before /chat/completions.")}</span>
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("Model")}</span>
          {settings.provider === "ANTHROPIC" ? (
            <select className={field} dir="ltr" value={settings.model} onChange={(e) => set("model", e.target.value)}>
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input className={field} dir="ltr" value={settings.model} onChange={(e) => set("model", e.target.value)} placeholder="gpt-4o-mini" />
          )}
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("API key")}</span>
          <input
            className={field}
            dir="ltr"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? t("Saved — leave empty to keep it") : "sk-…"}
          />
          <span className="text-xs text-muted">{t("Stored encrypted on your server and never shown again. Usage is billed by the provider to this key.")}</span>
        </label>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("Who it speaks for")}</span>
          <textarea
            className={`${field} min-h-24`}
            value={settings.persona}
            maxLength={4000}
            onChange={(e) => set("persona", e.target.value)}
            placeholder={t("e.g. A cinema in Tehran that screens classic films. Speak like a helpful box-office assistant.")}
          />
        </label>
        <div className="space-y-1">
          <span className="text-sm font-medium">{t("Tone")}</span>
          <div className="flex flex-wrap gap-2">
            {TONE_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => set("tone", i + 1)}
                className={`rounded-full border px-3 py-1 text-xs ${settings.tone === i + 1 ? "border-accent bg-accent text-white" : "border-border"}`}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("Knowledge base")}</span>
          <textarea
            className={`${field} min-h-48`}
            value={settings.knowledge}
            maxLength={KNOWLEDGE_MAX}
            onChange={(e) => set("knowledge", e.target.value)}
            placeholder={t("Prices, hours, address, shipping, return policy, frequent questions… Anything not written here, it will not claim to know.")}
          />
          <span className="text-xs text-muted">
            {t("{count} of {max} characters", { count: [...settings.knowledge].length, max: KNOWLEDGE_MAX })}
          </span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("AI replies per person per day")}</span>
          <input
            type="number"
            min={1}
            max={200}
            className={`${control} w-24`}
            value={settings.dailyLimitPerPerson}
            onChange={(e) => set("dailyLimitPerPerson", Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
          />
          <span className="block text-xs text-muted">{t("Past this, they get no AI answer until the next day, which caps what one chatty person can cost you.")}</span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t("Saving…") : t("Save")}
        </button>
        {message && <p className={`text-sm ${message.ok ? "text-success" : "text-error"}`}>{message.text}</p>}
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold">{t("Try it")}</h2>
        <p className="text-xs text-muted">{t("Asks the saved assistant; nothing is sent to Instagram.")}</p>
        <div className="flex gap-2">
          <input className={field} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("e.g. How much is a ticket?")} />
          <button type="button" disabled={trying || !question.trim() || !hasKey} onClick={() => void tryIt()} className="shrink-0 rounded-lg border border-border px-4 text-sm disabled:opacity-50">
            {trying ? t("Asking…") : t("Ask")}
          </button>
        </div>
        {trial && <p className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${trial.ok ? "bg-background" : "bg-error/10 text-error"}`}>{trial.text}</p>}
      </section>

      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{t("Recent AI replies")}</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {recent.map((r) => (
              <div key={r.id} className="space-y-1 p-3 text-sm">
                <p className="text-xs text-muted">
                  {date(r.createdAt)} · {t(r.status === "SENT" ? "Sent" : r.status === "PENDING" ? "Pending" : "Failed")}
                </p>
                <p>{r.question}</p>
                {r.answer && <p className="text-muted">↳ {r.answer}</p>}
                {r.error && <p className="text-xs text-error">{r.error}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
