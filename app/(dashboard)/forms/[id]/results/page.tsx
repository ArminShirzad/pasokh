"use client";

import { handle } from "@/lib/text/handle";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { FormQuestion } from "@/lib/forms/answers";

type Row = { id: string; igsid: string; username: string | null; status: string; answers: Record<string, string>; startedAt: string; completedAt: string | null };

const STATUS_LABEL = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In progress",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
} as const;

export default function FormResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const [latest, setLatest] = useState(true);
  const [onlyCompleted, setOnlyCompleted] = useState(true);
  const [data, setData] = useState<{ form: { name: string; questions: FormQuestion[] }; rows: Row[] } | null>(null);
  const [missing, setMissing] = useState(false);

  const query = `${latest ? "latest=1&" : ""}${onlyCompleted ? "status=COMPLETED" : ""}`;
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/forms/${encodeURIComponent(id)}/results?${query}`).then(async (r) => {
      if (cancelled) return;
      if (!r.ok) return setMissing(true);
      setData(await r.json());
    });
    return () => {
      cancelled = true;
    };
  }, [id, query]);

  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";

  if (missing) return <p className="text-sm text-error">{t("Form not found.")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/forms" className="text-sm text-muted hover:text-foreground">
          <span className="inline-block rtl:rotate-180">←</span> {t("Forms")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{data ? t("Results: {name}", { name: data.form.name }) : t("Results")}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={latest} onChange={(e) => setLatest(e.target.checked)} />
          {t("One row per person (latest answers)")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyCompleted} onChange={(e) => setOnlyCompleted(e.target.checked)} />
          {t("Completed only")}
        </label>
        <a href={`/api/forms/${encodeURIComponent(id)}/results?${query}&format=csv`} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
          {t("Download for Excel (CSV)")}
        </a>
      </div>

      {!data ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : data.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">{t("No answers yet.")}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("Person")}</th>
                {data.form.questions.map((q) => (
                  <th key={q.id} className="max-w-48 px-3 py-2 text-start font-medium">{q.text}</th>
                ))}
                <th className="px-3 py-2 text-start font-medium">{t("Status")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Date")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">{r.username ? handle(r.username) : r.igsid.slice(-8)}</td>
                  {data.form.questions.map((q) => (
                    <td key={q.id} className="px-3 py-2" dir={q.kind === "phone" || q.kind === "email" || q.kind === "number" ? "ltr" : undefined}>
                      {r.answers[q.id] ?? "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs">{t(STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? "In progress")}</td>
                  <td className="px-3 py-2 text-xs text-muted">{date(r.completedAt ?? r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
