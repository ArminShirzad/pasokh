import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getDMQueue, SMS_JOB_NAME } from "@/lib/queue/client";
import { contactWhere } from "@/lib/contacts/list";
import { normalizePhone } from "@/lib/forms/answers";
import { SMS_BATCH, SmsRefusedError, SmsUnclearError, sendSms, type SmsConfig, type SmsProviderName } from "./providers";

export async function smsConfig(workspaceId: string): Promise<SmsConfig | null> {
  const settings = await prisma.smsSettings.findUnique({ where: { workspaceId } });
  if (!settings) return null;
  return {
    provider: settings.provider as SmsProviderName,
    apiKey: settings.apiKey ? decryptToken(settings.apiKey) : "",
    sender: settings.sender,
  };
}

/** The phones a filter selects now, normalised and without repeats. */
export async function recipientsFor(workspaceId: string, filter: { accountId?: string | null; tag?: string | null }) {
  const contacts = await prisma.contact.findMany({
    where: contactWhere({ workspaceId, accountId: filter.accountId, tag: filter.tag, hasPhone: true }),
    select: { phone: true },
    take: 100_000,
  });
  return [...new Set(contacts.map((c) => (c.phone ? normalizePhone(c.phone) : null)).filter((p): p is string => Boolean(p)))];
}

/** Fixes the recipients and queues the first batch. */
export async function createSmsCampaign({
  workspaceId,
  name,
  message,
  filter,
}: {
  workspaceId: string;
  name: string;
  message: string;
  filter: { accountId?: string | null; tag?: string | null };
}) {
  const settings = await prisma.smsSettings.findUnique({ where: { workspaceId } });
  if (!settings) throw new Error("Set up an SMS provider first.");
  const phones = await recipientsFor(workspaceId, filter);
  if (phones.length === 0) throw new Error("No contact matching this filter has a phone number.");
  const campaign = await prisma.smsCampaign.create({
    data: {
      workspaceId,
      name,
      message,
      provider: settings.provider,
      filter: { accountId: filter.accountId ?? null, tag: filter.tag ?? null },
      messages: { createMany: { data: phones.map((phone) => ({ phone })), skipDuplicates: true } },
    },
  });
  await getDMQueue().add(SMS_JOB_NAME, { campaignId: campaign.id }, { jobId: `sms_${campaign.id}_0` });
  return campaign;
}

async function stop(campaignId: string, reason: string) {
  await prisma.smsMessage.updateMany({ where: { campaignId, status: "PENDING" }, data: { status: "FAILED", error: "Not sent: the send was stopped" } });
  await prisma.smsCampaign.update({ where: { id: campaignId }, data: { status: "STOPPED", stopReason: reason } });
}

/**
 * Sends the next batch, then queues the one after. The batch is claimed
 * (PENDING → SENDING) before the provider is called, so a job run twice
 * finds nothing left to claim.
 */
export async function processSmsBatch(campaignId: string, round = 0): Promise<"SENT" | "DONE" | "STOPPED" | "SKIPPED"> {
  const campaign = await prisma.smsCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status === "DONE" || campaign.status === "STOPPED") return "SKIPPED";

  const config = await smsConfig(campaign.workspaceId);
  if (!config) {
    await stop(campaignId, "The SMS provider settings were removed");
    return "STOPPED";
  }

  // Each run claims under its own id and then reads back only what it got:
  // Postgres re-checks `status = PENDING` under the row lock, so overlapping
  // runs split the rows instead of sharing them, and a run never touches
  // rows another run claimed. (Read-then-claim with a "hand back" step let an
  // overlapping run return the first run's rows to PENDING mid-send.)
  const claimId = randomUUID();
  const candidates = await prisma.smsMessage.findMany({ where: { campaignId, status: "PENDING" }, orderBy: { id: "asc" }, take: SMS_BATCH, select: { id: true } });
  await prisma.smsMessage.updateMany({
    where: { id: { in: candidates.map((c) => c.id) }, status: "PENDING" },
    data: { status: "SENDING", claimId },
  });
  const batch = await prisma.smsMessage.findMany({ where: { claimId }, orderBy: { id: "asc" }, select: { id: true, phone: true } });
  if (batch.length === 0) {
    const open = await prisma.smsMessage.count({ where: { campaignId, status: { in: ["PENDING", "SENDING"] } } });
    // Rows still SENDING belong to a run in progress; that run finishes the send.
    if (open === 0) await prisma.smsCampaign.update({ where: { id: campaignId }, data: { status: "DONE" } });
    return open === 0 ? "DONE" : "SKIPPED";
  }
  if (campaign.status === "QUEUED") await prisma.smsCampaign.update({ where: { id: campaignId }, data: { status: "SENDING" } });

  try {
    const result = await sendSms(config, batch.map((m) => m.phone), campaign.message);
    await prisma.$transaction(
      batch.map((m, i) => prisma.smsMessage.updateMany({ where: { id: m.id, claimId }, data: { status: "SENT", providerId: result.ids[i] } })),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof SmsRefusedError) {
      await prisma.smsMessage.updateMany({ where: { claimId }, data: { status: "FAILED", error: reason } });
      if (error.account) {
        await stop(campaignId, reason);
        return "STOPPED";
      }
    } else {
      // Sent or not, we cannot tell: never send these again, and stop, since
      // the next batch would most likely meet the same problem.
      await prisma.smsMessage.updateMany({ where: { claimId }, data: { status: "UNCONFIRMED", error: reason } });
      await stop(campaignId, error instanceof SmsUnclearError ? reason : `Unexpected error: ${reason}`);
      return "STOPPED";
    }
  }

  await getDMQueue().add(SMS_JOB_NAME, { campaignId, round: round + 1 }, { jobId: `sms_${campaignId}_${round + 1}` });
  return "SENT";
}

export async function campaignCounts(campaignIds: string[]) {
  const rows = await prisma.smsMessage.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaignIds } }, _count: { _all: true } });
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const c = out.get(r.campaignId) ?? {};
    c[r.status] = r._count._all;
    out.set(r.campaignId, c);
  }
  return out;
}
