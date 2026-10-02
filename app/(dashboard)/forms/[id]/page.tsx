"use client";

import { handle } from "@/lib/text/handle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import type { ContactField, FormQuestion, QuestionKind } from "@/lib/forms/answers";

type Account = { id: string; username: string };
type Draft = {
  name: string;
  instagramAccountId: string;
  isActive: boolean;
  questions: FormQuestion[];
  cancelWord: string;
  completionMessage: string;
  cancelMessage: string;
};
type Problem = { path: string; message: string };

const control =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none";
const field = `w-full ${control}`;
const smallButton = "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover";

const KINDS: [QuestionKind, StaticMessageKey][] = [
  ["text", "Text answer"],
  ["phone", "Phone number"],
  ["email", "Email"],
  ["number", "Number"],
  ["choice", "Choice of options"],
];

/** The contact field a question can fill, by its kind. */
const SAVE_TO: Partial<Record<QuestionKind, ContactField[]>> = { text: ["name"], phone: ["phone"], email: ["email"] };
const SAVE_LABEL: Record<ContactField, StaticMessageKey> = { name: "Save as the contact's name", phone: "Save as the contact's phone", email: "Save as the contact's email" };

const newId = () => Math.random().toString(36).slice(2, 10);

export default function FormEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [startedBy, setStartedBy] = useState<{ id: string; name: string }[]>([]);
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
        if (list.length) {
          setDraft({
            name: "",
            instagramAccountId: list[0].id,
            isActive: true,
            questions: [{ id: newId(), text: "", kind: "text" }],
            cancelWord: t("cancel"),
            completionMessage: t("Thanks, we received your answers."),
            cancelMessage: t("Cancelled. Message us any time."),
          });
        }
        return;
      }
      const response = await fetch(`/api/forms/${encodeURIComponent(id)}`);
      if (!response.ok) {
        if (!cancelled) setMissing(true);
        return;
      }
      const data = await response.json();
      if (cancelled) return;
      const f = data.form;
      setDraft({ name: f.name, instagramAccountId: f.instagramAccountId, isActive: f.isActive, questions: f.questions, cancelWord: f.cancelWord, completionMessage: f.completionMessage, cancelMessage: f.cancelMessage });
      setStartedBy(data.startedBy ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew, t]);

  if (missing) return <p className="text-sm text-error">{t("Form not found.")}</p>;
  if (accounts && accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        {t("Connect an Instagram account first, or open the test lab to get a test account.")}{" "}
        <Link href="/simulator" className="text-accent underline">{t("Test lab")}</Link>
      </p>
    );
  }
  if (!draft || !accounts) return <p className="text-sm text-muted">{t("Loading…")}</p>;

  const setQuestions = (questions: FormQuestion[]) => setDraft({ ...draft, questions });
  const updateQuestion = (index: number, next: FormQuestion) => setQuestions(draft.questions.map((q, i) => (i === index ? next : q)));
  const problemsAt = (prefix: string) => problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`));

  async function save() {
    if (!draft) return;
    setSaving(true);
    setProblems([]);
    setError(null);
    try {
      const response = await fetch(isNew ? "/api/forms" : `/api/forms/${id}`, {
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
            : data.issues?.length
              ? t("Fill in every question and message.")
              : data.error
                ? t(data.error as StaticMessageKey)
                : t("Could not save.")
        );
        return;
      }
      router.push("/forms");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/forms" className="text-sm text-muted hover:text-foreground">
          <span className="inline-block rtl:rotate-180">←</span> {t("Forms")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{isNew ? t("New form") : t("Edit form")}</h1>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("Form name")}</span>
          <input className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("e.g. Course sign-up")} />
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
        <p className="text-xs text-muted">
          {startedBy.length
            ? t("Started by: {names}", { names: startedBy.map((c) => c.name).join("، ") })
            : t("No smart reply starts this form yet. Choose it under “Then start a form” in a smart reply.")}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">{t("Questions")}</h2>
        {draft.questions.map((q, index) => {
          const saveOptions = SAVE_TO[q.kind] ?? [];
          return (
            <div key={q.id} className={`space-y-2 rounded-xl border bg-surface p-4 ${problemsAt(`questions[${index}]`).length ? "border-error/50" : "border-border"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{t("Question {number}", { number: index + 1 })}</p>
                <div className="flex gap-1 text-xs">
                  <button type="button" disabled={index === 0} className="rounded px-2 py-1 text-muted disabled:opacity-30" aria-label={t("Move up")} onClick={() => {
                    const qs = [...draft.questions];
                    [qs[index - 1], qs[index]] = [qs[index], qs[index - 1]];
                    setQuestions(qs);
                  }}>↑</button>
                  <button type="button" disabled={index === draft.questions.length - 1} className="rounded px-2 py-1 text-muted disabled:opacity-30" aria-label={t("Move down")} onClick={() => {
                    const qs = [...draft.questions];
                    [qs[index + 1], qs[index]] = [qs[index], qs[index + 1]];
                    setQuestions(qs);
                  }}>↓</button>
                  {draft.questions.length > 1 && (
                    <button type="button" className="rounded px-2 py-1 text-error" onClick={() => setQuestions(draft.questions.filter((_, i) => i !== index))}>{t("Remove")}</button>
                  )}
                </div>
              </div>
              <textarea className={`${field} min-h-20`} value={q.text} placeholder={t("e.g. What is your phone number?")} onChange={(e) => updateQuestion(index, { ...q, text: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <select
                  className={`${control} w-auto`}
                  value={q.kind}
                  onChange={(e) => {
                    const kind = e.target.value as QuestionKind;
                    updateQuestion(index, {
                      id: q.id,
                      text: q.text,
                      kind,
                      ...(kind === "choice" ? { choices: q.choices?.length ? q.choices : ["", ""] } : {}),
                    });
                  }}
                >
                  {KINDS.map(([value, label]) => (
                    <option key={value} value={value}>{t(label)}</option>
                  ))}
                </select>
                {saveOptions.map((target) => (
                  <label key={target} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={q.saveTo === target} onChange={(e) => updateQuestion(index, { ...q, saveTo: e.target.checked ? target : undefined })} />
                    {t(SAVE_LABEL[target])}
                  </label>
                ))}
              </div>
              {q.kind === "phone" && <p className="text-xs text-muted">{t("Accepts 0912…, +98912… and Persian digits; anything else is asked again.")}</p>}
              {q.kind === "choice" && (
                <div className="space-y-2">
                  {(q.choices ?? []).map((choice, ci) => (
                    <div key={ci} className="flex gap-2">
                      <input
                        className={field}
                        value={choice}
                        maxLength={20}
                        placeholder={t("Option {number}", { number: ci + 1 })}
                        onChange={(e) => updateQuestion(index, { ...q, choices: (q.choices ?? []).map((c, j) => (j === ci ? e.target.value : c)) })}
                      />
                      {(q.choices?.length ?? 0) > 2 && (
                        <button type="button" className="text-xs text-error" onClick={() => updateQuestion(index, { ...q, choices: (q.choices ?? []).filter((_, j) => j !== ci) })}>✕</button>
                      )}
                    </div>
                  ))}
                  {(q.choices?.length ?? 0) < 13 && (
                    <button type="button" className={smallButton} onClick={() => updateQuestion(index, { ...q, choices: [...(q.choices ?? []), ""] })}>
                      + {t("Add option")}
                    </button>
                  )}
                  <p className="text-xs text-muted">{t("Shown as quick-reply buttons; typing the option or its number also works.")}</p>
                </div>
              )}
              {problemsAt(`questions[${index}]`).map((p, i) => (
                <p key={i} className="text-xs text-error">{t(p.message as StaticMessageKey)}</p>
              ))}
            </div>
          );
        })}
        {draft.questions.length < 20 && (
          <button type="button" className={smallButton} onClick={() => setQuestions([...draft.questions, { id: newId(), text: "", kind: "text" }])}>
            + {t("Add question")}
          </button>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("Cancel word")}</span>
          <input className={`${control} w-40`} value={draft.cancelWord} onChange={(e) => setDraft({ ...draft, cancelWord: e.target.value })} />
          <span className="block text-xs text-muted">{t("Sending exactly this word stops the form.")}</span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("Message when finished")}</span>
          <textarea className={`${field} min-h-16`} value={draft.completionMessage} onChange={(e) => setDraft({ ...draft, completionMessage: e.target.value })} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("Message when cancelled")}</span>
          <textarea className={`${field} min-h-16`} value={draft.cancelMessage} onChange={(e) => setDraft({ ...draft, cancelMessage: e.target.value })} />
        </label>
        <p className="text-xs text-muted">{t("{username} becomes their Instagram username.", { username: "{username}" })}</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t("Saving…") : t("Save form")}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
          {t("Active")}
        </label>
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    </div>
  );
}
