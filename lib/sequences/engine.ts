import { prisma } from "@/lib/db/client";
import { getDMQueue, SEQUENCE_JOB_NAME } from "@/lib/queue/client";
import {
  RateLimitError,
  createInstagramContext,
  sendOutboundMessage,
} from "@/lib/instagram/provider";
import { classifySendError, isConfirmedSendRejection, isDeliveryUnconfirmed } from "@/lib/instagram/delivery-errors";
import { isInMessagingWindow } from "@/lib/contacts/touch";
import { validateOutbound, type Card } from "@/lib/messages/outbound";
import { resolveResponses, type StoredResponse } from "@/lib/messages/stored";
import { personalize } from "@/lib/commands/engine";

export type SequenceStep = { delayMinutes: number; response: StoredResponse };

export { WINDOW_MINUTES, stepOffsets } from "./window";

function jobId(enrollmentId: string, step: number, startedAt: Date) {
  return `seq_${enrollmentId}_${step}_${startedAt.getTime()}`;
}

async function schedule(enrollment: { id: string; startedAt: Date }, step: number, delayMinutes: number) {
  const delay = Math.max(0, delayMinutes) * 60_000;
  await prisma.sequenceEnrollment.update({
    where: { id: enrollment.id },
    data: { nextAt: new Date(Date.now() + delay) },
  });
  await getDMQueue().add(
    SEQUENCE_JOB_NAME,
    { enrollmentId: enrollment.id, step },
    { delay, jobId: jobId(enrollment.id, step, enrollment.startedAt) },
  );
}

/**
 * Enrolls a person (again, if an earlier run is over). Someone already in the
 * sequence is left where they are: starting over would send them the early
 * steps twice.
 */
export async function startSequence({
  sequenceId,
  igsid,
  username,
}: {
  sequenceId: string;
  igsid: string;
  username?: string | null;
}): Promise<"STARTED" | "ALREADY_ACTIVE" | "INACTIVE"> {
  const sequence = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  const steps = (sequence?.steps ?? []) as SequenceStep[];
  if (!sequence?.isActive || steps.length === 0) return "INACTIVE";

  const existing = await prisma.sequenceEnrollment.findUnique({
    where: { sequenceId_igsid: { sequenceId, igsid } },
  });
  if (existing?.status === "ACTIVE") return "ALREADY_ACTIVE";

  const startedAt = new Date();
  const fresh = { status: "ACTIVE", nextStep: 0, startedAt, stopReason: null, ...(username ? { username } : {}) };
  const enrollment = existing
    ? await prisma.sequenceEnrollment.update({ where: { id: existing.id }, data: fresh })
    : await prisma.sequenceEnrollment.create({ data: { sequenceId, igsid, ...fresh } });
  await schedule(enrollment, 0, steps[0].delayMinutes);
  return "STARTED";
}

async function finish(id: string, status: string, stopReason: string | null) {
  await prisma.sequenceEnrollment.update({ where: { id }, data: { status, stopReason, nextAt: null } });
}

/**
 * Sends one step. The step is claimed by advancing nextStep first, so a job
 * delivered twice sends it once; only a rate limit (nothing sent) hands the
 * claim back for the retry.
 */
export async function runSequenceStep(enrollmentId: string, step: number): Promise<string> {
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { sequence: { include: { instagramAccount: true } } },
  });
  if (!enrollment || enrollment.status !== "ACTIVE" || enrollment.nextStep !== step) return "SKIPPED";
  const { sequence } = enrollment;
  const steps = sequence.steps as SequenceStep[];

  if (!sequence.isActive) {
    await finish(enrollment.id, "STOPPED", "Sequence turned off");
    return "STOPPED";
  }
  if (step >= steps.length) {
    await finish(enrollment.id, "DONE", null);
    return "DONE";
  }

  const contact = await prisma.contact.findUnique({
    where: { instagramAccountId_igsid: { instagramAccountId: sequence.instagramAccountId, igsid: enrollment.igsid } },
    select: { lastInboundAt: true, username: true },
  });
  if (sequence.stopOnReply && contact?.lastInboundAt && contact.lastInboundAt > enrollment.startedAt) {
    await finish(enrollment.id, "STOPPED", "They replied");
    return "STOPPED";
  }
  // Instagram would refuse it; sending anyway only produces a failure.
  if (!isInMessagingWindow(contact?.lastInboundAt)) {
    await finish(enrollment.id, "STOPPED", "24-hour messaging window closed");
    return "STOPPED";
  }

  const stored = steps[step].response;
  let showcases = new Map<string, Card[]>();
  if (stored.type === "showcase") {
    const found = await prisma.showcase.findFirst({
      where: { id: stored.showcaseId, instagramAccountId: sequence.instagramAccountId },
      select: { id: true, cards: true },
    });
    if (found) showcases = new Map([[found.id, found.cards as Card[]]]);
  }
  const [message] = resolveResponses([stored], showcases);
  if (!message || validateOutbound(message).length) {
    await finish(enrollment.id, "FAILED", message ? `Step ${step + 1} is not a valid message` : `Step ${step + 1}: its showcase was deleted`);
    return "FAILED";
  }

  const claimed = await prisma.sequenceEnrollment.updateMany({
    where: { id: enrollment.id, status: "ACTIVE", nextStep: step },
    data: { nextStep: step + 1 },
  });
  if (claimed.count === 0) return "SKIPPED";

  try {
    const context = await createInstagramContext(sequence.instagramAccount, `seq:${enrollment.id}:${step}`);
    await sendOutboundMessage({
      context,
      instagramAccountId: sequence.instagramAccount.instagramId,
      recipient: { userId: enrollment.igsid },
      message: personalize(message, contact?.username ?? enrollment.username),
    });
  } catch (raw) {
    if (raw instanceof RateLimitError) {
      // Nothing was sent: give the step back so the retry sends it.
      await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { nextStep: step } });
      throw raw;
    }
    const error = classifySendError(raw);
    const text = error instanceof Error ? error.message : String(error);
    // Never retried: a possibly delivered step must not be sent again, and a
    // refused one (window closed, blocked) will be refused again.
    const status = isDeliveryUnconfirmed(error) || !isConfirmedSendRejection(error) ? "UNCONFIRMED" : "FAILED";
    await finish(enrollment.id, status, text);
    return status;
  }

  if (step + 1 >= steps.length) {
    await finish(enrollment.id, "DONE", null);
    return "DONE";
  }
  await schedule(enrollment, step + 1, steps[step + 1].delayMinutes);
  return "SENT";
}
