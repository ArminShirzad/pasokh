import { prisma } from "@/lib/db/client";
import { RateLimitError, createInstagramContext, sendOutboundMessage } from "@/lib/instagram/provider";
import type { OutboundMessage } from "@/lib/messages/outbound";
import { handle } from "@/lib/text/handle";
import { defaultLocale } from "@/lib/i18n";
import { isCancel, parseAnswer, type FormQuestion } from "./answers";

/** A form left unanswered this long is over: Instagram stops accepting our messages after 24 hours. */
const FORM_TTL_MS = 24 * 60 * 60 * 1000;

export const FORM_PAYLOAD = /^form:([a-z0-9]+):(\d+)$/;

type FormWithAccount = Awaited<ReturnType<typeof loadForm>>;

function loadForm(id: string) {
  return prisma.form.findUnique({ where: { id }, include: { instagramAccount: true } });
}

function fill(text: string, username: string | null | undefined) {
  return text.replace(/\{username\}/g, username ? handle(username) : "");
}

// Said again before a question when the answer did not fit. Goes to the
// owner's followers, so it follows the instance language.
function retryHint(question: FormQuestion): string {
  const fa = defaultLocale() === "fa";
  switch (question.kind) {
    case "phone":
      return fa ? "این شماره درست به نظر نمی‌رسد؛ مثلاً ۰۹۱۲۳۴۵۶۷۸۹ بنویسید." : "That does not look like a phone number; for example 09123456789.";
    case "email":
      return fa ? "این ایمیل درست به نظر نمی‌رسد." : "That does not look like an email address.";
    case "number":
      return fa ? "لطفاً فقط عدد بنویسید." : "Please answer with a number.";
    case "choice":
      return fa ? "لطفاً یکی از گزینه‌ها را انتخاب کنید." : "Please pick one of the options.";
    default:
      return fa ? "لطفاً جواب را بنویسید." : "Please type your answer.";
  }
}

function questionMessage(submissionId: string, question: FormQuestion, username: string | null, prefix?: string): OutboundMessage {
  const text = `${prefix ? `${prefix}\n\n` : ""}${fill(question.text, username)}`;
  if (question.kind === "choice" && question.choices?.length) {
    return {
      type: "text",
      text,
      quickReplies: question.choices.map((title, i) => ({ title, payload: `form:${submissionId}:${i}` })),
    };
  }
  return { type: "text", text };
}

async function send(form: NonNullable<FormWithAccount>, igsid: string, message: OutboundMessage, tag: string) {
  const context = await createInstagramContext(form.instagramAccount, tag);
  await sendOutboundMessage({ context, instagramAccountId: form.instagramAccount.instagramId, recipient: { userId: igsid }, message });
}

/**
 * Starts asking a form's questions. One form at a time per person: an older
 * unfinished one on the same account is closed, or their answers would be
 * read against the wrong questions.
 */
export async function startForm({ formId, igsid, username }: { formId: string; igsid: string; username?: string | null }) {
  const form = await loadForm(formId);
  const questions = (form?.questions ?? []) as FormQuestion[];
  if (!form?.isActive || questions.length === 0) return null;

  await prisma.formSubmission.updateMany({
    where: { igsid, status: "IN_PROGRESS", form: { instagramAccountId: form.instagramAccountId } },
    data: { status: "EXPIRED" },
  });
  const submission = await prisma.formSubmission.create({
    data: { formId, igsid, username: username ?? null },
  });
  await send(form, igsid, questionMessage(submission.id, questions[0], username ?? null), `form:${submission.id}:ask0`);
  return submission;
}

/**
 * Takes a DM as the answer to the person's open form, if they have one.
 * Returns true when the message was consumed, so nothing else answers it.
 * A quick reply that is not one of the form's own is left alone (a menu
 * tap still opens its command; the form stays open).
 */
export async function handleFormMessage({
  instagramId,
  igsid,
  messageId,
  text,
  quickReplyPayload,
}: {
  instagramId: string;
  igsid: string;
  messageId: string;
  text: string;
  quickReplyPayload?: string;
}): Promise<boolean> {
  if (quickReplyPayload && !FORM_PAYLOAD.test(quickReplyPayload)) return false;

  const submission = await prisma.formSubmission.findFirst({
    where: { igsid, status: "IN_PROGRESS", form: { instagramAccount: { instagramId } } },
    orderBy: { startedAt: "desc" },
  });
  if (!submission) return false;
  if (Date.now() - submission.startedAt.getTime() > FORM_TTL_MS) {
    await prisma.formSubmission.update({ where: { id: submission.id }, data: { status: "EXPIRED" } });
    return false;
  }
  if (submission.lastMessageId === messageId) return true; // the same webhook again

  const form = await loadForm(submission.formId);
  if (!form) return false;
  const questions = form.questions as FormQuestion[];
  const question = questions[submission.step];
  const username = submission.username;

  // Claims this message for this step: a redelivered webhook, or two jobs
  // racing, find the claim taken and do nothing.
  const claim = (data: Record<string, unknown>) =>
    prisma.formSubmission.updateMany({
      where: {
        id: submission.id,
        status: "IN_PROGRESS",
        step: submission.step,
        OR: [{ lastMessageId: null }, { lastMessageId: { not: messageId } }],
      },
      data: { lastMessageId: messageId, ...data },
    });
  const undo = () =>
    prisma.formSubmission.update({
      where: { id: submission.id },
      data: { lastMessageId: submission.lastMessageId, step: submission.step, status: "IN_PROGRESS", answers: submission.answers ?? {}, completedAt: null },
    });
  // A rate limit means nothing was sent: hand the claim back so the retry
  // of this job answers them. Anything else is not retried.
  const sendOrUndo = async (message: OutboundMessage, tag: string) => {
    try {
      await send(form, igsid, message, tag);
    } catch (error) {
      if (error instanceof RateLimitError) {
        await undo();
        throw error;
      }
      await prisma.operationalEvent
        .create({
          data: {
            workspaceId: form.workspaceId,
            source: "WORKER",
            level: "ERROR",
            message: "A form message could not be sent",
            payload: { formId: form.id, submissionId: submission.id, error: error instanceof Error ? error.message : String(error) },
          },
        })
        .catch(() => {});
    }
  };

  if (!quickReplyPayload && isCancel(text, form.cancelWord)) {
    if ((await claim({ status: "CANCELLED" })).count === 0) return true;
    await sendOrUndo({ type: "text", text: fill(form.cancelMessage, username) }, `form:${submission.id}:cancel`);
    return true;
  }
  if (!question) return false;

  const tapped = quickReplyPayload ? FORM_PAYLOAD.exec(quickReplyPayload) : null;
  if (tapped && tapped[1] !== submission.id) return true; // a button of an older form
  const value = tapped ? (question.choices?.[Number(tapped[2])] ?? null) : parseAnswer(question, text);

  if (value === null) {
    if ((await claim({})).count === 0) return true;
    await sendOrUndo(questionMessage(submission.id, question, username, retryHint(question)), `form:${submission.id}:retry:${messageId}`);
    return true;
  }

  const answers = { ...((submission.answers ?? {}) as Record<string, string>), [question.id]: value };
  const done = submission.step + 1 >= questions.length;
  const claimed = await claim({
    answers,
    step: submission.step + 1,
    ...(done ? { status: "COMPLETED", completedAt: new Date() } : {}),
  });
  if (claimed.count === 0) return true;

  if (question.saveTo) {
    await prisma.contact
      .upsert({
        where: { instagramAccountId_igsid: { instagramAccountId: form.instagramAccountId, igsid } },
        create: { instagramAccountId: form.instagramAccountId, igsid, [question.saveTo]: value },
        update: { [question.saveTo]: value },
      })
      .catch(() => {});
  }

  await sendOrUndo(
    done
      ? { type: "text", text: fill(form.completionMessage, username) }
      : questionMessage(submission.id, questions[submission.step + 1], username),
    `form:${submission.id}:ask${submission.step + 1}`,
  );
  return true;
}
