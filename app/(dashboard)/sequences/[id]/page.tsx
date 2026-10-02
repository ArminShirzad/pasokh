"use client";

import { handle } from "@/lib/text/handle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { ResponseEditor, type CommandSummary, type ShowcaseSummary } from "@/components/command-editor";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import type { StoredResponse } from "@/lib/messages/stored";
import { WINDOW_MINUTES, stepOffsets } from "@/lib/sequences/window";

type Account = { id: string; username: string };
type Step = { delayMinutes: number; response: StoredResponse };
type Draft = { name: string; instagramAccountId: string; isActive: boolean; stopOnReply: boolean; steps: Step[] };
type Problem = { path: string; message: string };
type Unit = "minutes" | "hours" | "days";

const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };
// Without a width, so a small control can set its own (w-full would win over w-24).
const control =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none";
const field = `w-full ${control}`;

function bestUnit(minutes: number): Unit {
  if (minutes > 0 && minutes % 1440 === 0) return "days";
  if (minutes > 0 && minutes % 60 === 0) return "hours";
  return "minutes";
}

export default function SequenceEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [startedBy, setStartedBy] = useState<{ id: string; name: string }[]>([]);
  const [commands, setCommands] = useState<CommandSummary[]>([]);
  const [showcases, setShowcases] = useState<ShowcaseSummary[] | null>(null);
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
          setDraft({ name: "", instagramAccountId: list[0].id, isActive: true, stopOnReply: true, steps: [{ delayMinutes: 60, response: { type: "text", text: "" } }] });
          setUnits(["hours"]);
        }
        return;
      }
      const response = await fetch(`/api/sequences/${encodeURIComponent(id)}`);
      if (!response.ok) {
        if (!cancelled) setMissing(true);
        return;
      }
      const data = await response.json();
      if (cancelled) return;
      const s = data.sequence;
      setDraft({ name: s.name, instagramAccountId: s.instagramAccountId, isActive: s.isActive, stopOnReply: s.stopOnReply, steps: s.steps });
      setUnits((s.steps as Step[]).map((step) => bestUnit(step.delayMinutes)));
      setStartedBy(data.startedBy ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const accountId = draft?.instagramAccountId;
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const qs = `?accountId=${encodeURIComponent(accountId)}`;
    void Promise.all([
      fetch(`/api/commands${qs}`).then((r) => r.json()),
      fetch(`/api/showcases${qs}`).then((r) => r.json()),
    ]).then(([c, s]) => {
      if (cancelled) return;
      setCommands(c.commands ?? []);
      setShowcases(s.showcases ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const offsets = useMemo(() => stepOffsets(draft?.steps ?? []), [draft?.steps]);

  if (missing) return <p className="text-sm text-error">{t("Sequence not found.")}</p>;
  if (accounts && accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        {t("Connect an Instagram account first, or open the test lab to get a test account.")}{" "}
        <Link href="/simulator" className="text-accent underline">{t("Test lab")}</Link>
      </p>
    );
  }
  if (!draft || !accounts) return <p className="text-sm text-muted">{t("Loading…")}</p>;

  const setSteps = (steps: Step[]) => setDraft({ ...draft, steps });
  const updateStep = (index: number, next: Step) => setSteps(draft.steps.map((s, i) => (i === index ? next : s)));

  async function save() {
    if (!draft) return;
    setSaving(true);
    setProblems([]);
    setError(null);
    try {
      const response = await fetch(isNew ? "/api/sequences" : `/api/sequences/${id}`, {
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
              : t("Could not save.")
        );
        return;
      }
      router.push("/sequences");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const problemsAt = (prefix: string) => problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sequences" className="text-sm text-muted hover:text-foreground">
          <span className="inline-block rtl:rotate-180">←</span> {t("Smart support")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{isNew ? t("New sequence") : t("Edit sequence")}</h1>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("Sequence name")}</span>
          <input className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("e.g. After the price list")} />
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.stopOnReply} onChange={(e) => setDraft({ ...draft, stopOnReply: e.target.checked })} />
          {t("Stop when they reply")}
        </label>
        <p className="text-xs text-muted">
          {startedBy.length
            ? t("Started by: {names}", { names: startedBy.map((c) => c.name).join("، ") })
            : t("No smart reply starts this sequence yet. Choose it under “Then start a sequence” in a smart reply.")}
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">{t("Steps")}</h2>
        {draft.steps.map((step, index) => {
          const unit = units[index] ?? "minutes";
          const late = offsets[index] >= WINDOW_MINUTES;
          return (
            <div key={index} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>{index === 0 ? t("Wait") : t("Then wait")}</span>
                <input
                  type="number"
                  min={0}
                  className={`${control} w-24`}
                  value={step.delayMinutes / UNIT_MINUTES[unit]}
                  onChange={(e) => updateStep(index, { ...step, delayMinutes: Math.max(0, Math.round(Number(e.target.value) * UNIT_MINUTES[unit])) })}
                />
                <select
                  className={`${control} w-auto`}
                  value={unit}
                  onChange={(e) => {
                    const next = e.target.value as Unit;
                    setUnits(units.map((u, i) => (i === index ? next : u)));
                    updateStep(index, { ...step, delayMinutes: Math.round((step.delayMinutes / UNIT_MINUTES[unit]) * UNIT_MINUTES[next]) });
                  }}
                >
                  <option value="minutes">{t("minutes")}</option>
                  <option value="hours">{t("hours")}</option>
                  <option value="days">{t("days")}</option>
                </select>
                <span>{t("and send:")}</span>
              </div>
              {late && (
                <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                  {draft.stopOnReply
                    ? t("This step comes 24 hours or more after they started. With “Stop when they reply” on, it can never be sent: Instagram only accepts messages within 24 hours of their last message.")
                    : t("This step comes 24 hours or more after they started, so it is sent only if they messaged you again in the 24 hours before it.")}
                </p>
              )}
              <ResponseEditor
                value={step.response}
                onChange={(response) => updateStep(index, { ...step, response })}
                onRemove={draft.steps.length > 1 ? () => {
                  setSteps(draft.steps.filter((_, i) => i !== index));
                  setUnits(units.filter((_, i) => i !== index));
                } : undefined}
                onMove={(by) => {
                  const steps = [...draft.steps];
                  const [item] = steps.splice(index, 1);
                  steps.splice(index + by, 0, item);
                  const nextUnits = [...units];
                  const [u] = nextUnits.splice(index, 1);
                  nextUnits.splice(index + by, 0, u);
                  setUnits(nextUnits);
                  setSteps(steps);
                }}
                canMoveUp={index > 0}
                canMoveDown={index < draft.steps.length - 1}
                commands={commands}
                showcases={showcases}
                problems={problemsAt(`steps[${index}]`)}
              />
            </div>
          );
        })}
        {draft.steps.length < 10 && (
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover"
            onClick={() => {
              setSteps([...draft.steps, { delayMinutes: 60, response: { type: "text", text: "" } }]);
              setUnits([...units, "hours"]);
            }}
          >
            + {t("Add step")}
          </button>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t("Saving…") : t("Save sequence")}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
          {t("Active")}
        </label>
        {error && <p className="text-sm text-error">{error}</p>}
        {problemsAt("steps").filter((p) => p.path === "steps").map((p, i) => (
          <p key={i} className="text-sm text-error">{t(p.message as StaticMessageKey)}</p>
        ))}
      </div>
    </div>
  );
}
