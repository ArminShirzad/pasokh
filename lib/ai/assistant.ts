import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { RateLimitError, createInstagramContext, sendOutboundMessage } from "@/lib/instagram/provider";
import { classifySendError, isConfirmedSendRejection, isDeliveryUnconfirmed } from "@/lib/instagram/delivery-errors";
import { complete, LlmRateLimitError, type ChatTurn } from "./llm";
import { cleanAnswer, systemPrompt } from "./prompt";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Earlier exchanges the model sees, so "and the price?" has something to refer to. */
const MEMORY_TURNS = 6;

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002";
}

export type AiOutcome = "SENT" | "OFF" | "LIMIT" | "DUPLICATE" | "FAILED" | "UNCONFIRMED";

/**
 * Answers a DM nothing else answered. The reply row is claimed before the
 * model is called; a redelivered webhook finds it and does nothing, unless
 * the answer was written but Instagram asked us to slow down, in which case
 * the stored answer is sent without a second model call.
 */
export async function answerWithAi({
  instagramId,
  accountConnectionId,
  igsid,
  messageId,
  text,
}: {
  instagramId: string;
  accountConnectionId?: string;
  igsid: string;
  messageId: string;
  text: string;
}): Promise<AiOutcome> {
  const assistant = await prisma.aiAssistant.findFirst({
    where: {
      enabled: true,
      instagramAccount: { instagramId, ...(accountConnectionId ? { id: accountConnectionId } : {}) },
    },
    include: { instagramAccount: true },
  });
  if (!assistant || !text.trim()) return "OFF";

  let reply = await prisma.aiReply.findUnique({
    where: { assistantId_triggerId: { assistantId: assistant.id, triggerId: messageId } },
  });
  if (reply && !(reply.status === "PENDING" && reply.answer)) return "DUPLICATE";

  if (!reply) {
    const today = await prisma.aiReply.count({
      where: { assistantId: assistant.id, igsid, status: "SENT", createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (today >= assistant.dailyLimitPerPerson) return "LIMIT";
    try {
      reply = await prisma.aiReply.create({
        data: { assistantId: assistant.id, igsid, triggerId: messageId, question: text.slice(0, 2000) },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return "DUPLICATE";
      throw error;
    }
  }
  const claimed = reply;

  let answer = claimed.answer;
  if (!answer) {
    const earlier = await prisma.aiReply.findMany({
      where: { assistantId: assistant.id, igsid, status: "SENT", id: { not: claimed.id } },
      orderBy: { createdAt: "desc" },
      take: MEMORY_TURNS,
    });
    const turns: ChatTurn[] = earlier
      .reverse()
      .flatMap((r) => [
        { role: "user" as const, content: r.question },
        { role: "assistant" as const, content: r.answer ?? "" },
      ]);
    turns.push({ role: "user", content: text });
    try {
      answer = cleanAnswer(
        await complete(
          { provider: assistant.provider === "OPENAI" ? "OPENAI" : "ANTHROPIC", model: assistant.model, baseUrl: assistant.baseUrl, apiKey: decryptToken(assistant.apiKey) },
          systemPrompt({ username: assistant.instagramAccount.username, persona: assistant.persona, tone: assistant.tone, knowledge: assistant.knowledge }),
          turns,
        ),
      );
    } catch (error) {
      if (error instanceof LlmRateLimitError) {
        // Nothing was produced: free the claim so the job's retry asks again.
        await prisma.aiReply.delete({ where: { id: claimed.id } });
        throw error;
      }
      await prisma.aiReply.update({ where: { id: claimed.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } });
      return "FAILED";
    }
    if (!answer) {
      await prisma.aiReply.update({ where: { id: claimed.id }, data: { status: "FAILED", error: "The model returned an empty answer" } });
      return "FAILED";
    }
    await prisma.aiReply.update({ where: { id: claimed.id }, data: { answer } });
  }

  try {
    const context = await createInstagramContext(assistant.instagramAccount, `ai:${claimed.id}`);
    await sendOutboundMessage({
      context,
      instagramAccountId: assistant.instagramAccount.instagramId,
      recipient: { userId: igsid },
      message: { type: "text", text: answer },
    });
  } catch (raw) {
    // Instagram asked us to wait: the answer stays stored (PENDING) and the
    // retry sends it as written.
    if (raw instanceof RateLimitError) throw raw;
    const error = classifySendError(raw);
    const status = isDeliveryUnconfirmed(error) || !isConfirmedSendRejection(error) ? "UNCONFIRMED" : "FAILED";
    await prisma.aiReply.update({ where: { id: claimed.id }, data: { status, error: error instanceof Error ? error.message : String(error) } });
    return status;
  }
  await prisma.aiReply.update({ where: { id: claimed.id }, data: { status: "SENT", error: null } });
  return "SENT";
}
