import { prisma } from "@/lib/db/client";

export const REPORT_DAYS = 30;
const CAP = 200_000;

/** Days are counted in the instance's time zone: Tehran's day starts 03:30 UTC. */
export function reportTimeZone(): string {
  return process.env.REPORT_TIMEZONE || process.env.TZ || "Asia/Tehran";
}

/** "2026-10-03" for an instant, in a time zone. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The last `days` day keys, oldest first, ending today. */
export function lastDays(days: number, timeZone: string, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(new Date(now.getTime() - i * 86_400_000), timeZone));
  return [...new Set(out)];
}

/** Counts instants per day, keeping only the given days. */
export function countByDay(dates: (Date | null)[], days: string[], timeZone: string): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const counts = days.map(() => 0);
  for (const date of dates) {
    if (!date) continue;
    const i = index.get(dayKey(date, timeZone));
    if (i !== undefined) counts[i]++;
  }
  return counts;
}

export const METRICS = ["campaignDms", "smartReplies", "aiReplies", "formsCompleted", "sequencesStarted", "smsSent", "newContacts", "linkClicks"] as const;
export type Metric = (typeof METRICS)[number];

export async function activityReport(workspaceId: string, now = new Date()) {
  const timeZone = reportTimeZone();
  const days = lastDays(REPORT_DAYS, timeZone, now);
  const since = new Date(now.getTime() - (REPORT_DAYS + 1) * 86_400_000);
  const account = { instagramAccount: { workspaceId } };

  const [campaignDms, smartReplies, aiReplies, formsCompleted, sequencesStarted, sms, newContacts, linkClicks] = await Promise.all([
    prisma.dmLog.findMany({ where: { workspaceId, status: "SENT", dmSentAt: { gte: since } }, select: { dmSentAt: true }, take: CAP }),
    prisma.commandRun.findMany({ where: { status: "DONE", createdAt: { gte: since }, command: { workspaceId } }, select: { createdAt: true }, take: CAP }),
    prisma.aiReply.findMany({ where: { status: "SENT", createdAt: { gte: since }, assistant: account }, select: { createdAt: true }, take: CAP }),
    prisma.formSubmission.findMany({ where: { status: "COMPLETED", completedAt: { gte: since }, form: { workspaceId } }, select: { completedAt: true }, take: CAP }),
    prisma.sequenceEnrollment.findMany({ where: { startedAt: { gte: since }, sequence: { workspaceId } }, select: { startedAt: true }, take: CAP }),
    prisma.smsMessage.findMany({ where: { status: "SENT", campaign: { workspaceId, createdAt: { gte: since } } }, select: { campaign: { select: { createdAt: true } } }, take: CAP }),
    prisma.contact.findMany({ where: { firstSeenAt: { gte: since }, ...account }, select: { firstSeenAt: true }, take: CAP }),
    prisma.linkClick.findMany({ where: { workspaceId, createdAt: { gte: since } }, select: { createdAt: true }, take: CAP }),
  ]);

  const series: Record<Metric, number[]> = {
    campaignDms: countByDay(campaignDms.map((r) => r.dmSentAt), days, timeZone),
    smartReplies: countByDay(smartReplies.map((r) => r.createdAt), days, timeZone),
    aiReplies: countByDay(aiReplies.map((r) => r.createdAt), days, timeZone),
    formsCompleted: countByDay(formsCompleted.map((r) => r.completedAt), days, timeZone),
    sequencesStarted: countByDay(sequencesStarted.map((r) => r.startedAt), days, timeZone),
    smsSent: countByDay(sms.map((r) => r.campaign.createdAt), days, timeZone),
    newContacts: countByDay(newContacts.map((r) => r.firstSeenAt), days, timeZone),
    linkClicks: countByDay(linkClicks.map((r) => r.createdAt), days, timeZone),
  };
  const totals = Object.fromEntries(METRICS.map((m) => [m, series[m].reduce((a, b) => a + b, 0)])) as Record<Metric, number>;
  return { timeZone, days, series, totals };
}
