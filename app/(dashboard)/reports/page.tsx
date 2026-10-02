"use client";

/** Reports («گزارش‌ها»): what each part of Pasokh did in the last 30 days. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";

type Metric = "campaignDms" | "smartReplies" | "aiReplies" | "formsCompleted" | "sequencesStarted" | "smsSent" | "newContacts" | "linkClicks";
type Report = { timeZone: string; days: string[]; series: Record<Metric, number[]>; totals: Record<Metric, number> };

const CARDS: { metric: Metric; label: StaticMessageKey; href: string }[] = [
  { metric: "newContacts", label: "New contacts", href: "/contacts" },
  { metric: "campaignDms", label: "Campaign DMs", href: "/campaigns" },
  { metric: "smartReplies", label: "Smart replies sent", href: "/commands" },
  { metric: "aiReplies", label: "AI replies", href: "/ai" },
  { metric: "formsCompleted", label: "Forms completed", href: "/forms" },
  { metric: "sequencesStarted", label: "Sequences started", href: "/sequences" },
  { metric: "smsSent", label: "SMS sent", href: "/sms" },
  { metric: "linkClicks", label: "Link clicks", href: "/campaigns" },
];

function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  const w = 6;
  const gap = 2;
  return (
    <svg viewBox={`0 0 ${values.length * (w + gap)} 40`} className="h-10 w-full" preserveAspectRatio="none" role="img" aria-hidden>
      {values.map((v, i) => (
        <rect key={i} x={i * (w + gap)} y={40 - (v / max) * 38} width={w} height={Math.max(v ? 2 : 0.5, (v / max) * 38)} rx={1} className={v ? "fill-accent" : "fill-border"}>
          <title>{`${labels[i]}: ${v}`}</title>
        </rect>
      ))}
    </svg>
  );
}

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    void fetch("/api/reports")
      .then((r) => r.json())
      .then(setReport);
  }, []);

  if (!report) return <p className="text-sm text-muted">{t("Loading…")}</p>;

  // Charts read left to right in both languages (time runs left to right on
  // every axis people are used to), so the bar row is not mirrored in RTL.
  const labels = report.days.map((d) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))
  );
  const number = (n: number) => n.toLocaleString(locale);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("Reports")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("What each part of Pasokh did in the last 30 days, by day ({zone}).", { zone: report.timeZone })}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map(({ metric, label, href }) => (
          <Link key={metric} href={href} className="space-y-2 rounded-xl border border-border bg-surface p-4 hover:border-accent/40">
            <p className="text-xs text-muted">{t(label)}</p>
            <p className="text-2xl font-semibold">{number(report.totals[metric])}</p>
            <div dir="ltr">
              <Bars values={report.series[metric]} labels={labels} />
              <div className="mt-1 flex justify-between text-[10px] text-muted">
                <span>{labels[0]}</span>
                <span>{labels.at(-1)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
