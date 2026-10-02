import { z } from "zod";
import { prisma } from "@/lib/db/client";

export const KNOWLEDGE_MAX = 20_000;

export const assistantInputSchema = z
  .object({
    instagramAccountId: z.string().min(1),
    enabled: z.boolean(),
    provider: z.enum(["ANTHROPIC", "OPENAI"]),
    model: z.string().trim().min(1).max(100),
    baseUrl: z.string().trim().url().max(300).nullable().optional(),
    /** Empty keeps the stored key; the stored key is never sent to the browser. */
    apiKey: z.string().trim().max(500).optional(),
    persona: z.string().max(4000).default(""),
    tone: z.number().int().min(1).max(4).default(2),
    knowledge: z.string().max(KNOWLEDGE_MAX).default(""),
    dailyLimitPerPerson: z.number().int().min(1).max(200).default(20),
  })
  .refine((v) => v.provider !== "OPENAI" || Boolean(v.baseUrl), {
    message: "An OpenAI-compatible provider needs its API address.",
    path: ["baseUrl"],
  });

export type AssistantInput = z.infer<typeof assistantInputSchema>;

/** Settings as the page shows them: whether a key is stored, never the key. */
export async function assistantView(instagramAccountId: string) {
  const a = await prisma.aiAssistant.findUnique({ where: { instagramAccountId } });
  const recent = a
    ? await prisma.aiReply.findMany({
        where: { assistantId: a.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, igsid: true, question: true, answer: true, status: true, error: true, createdAt: true },
      })
    : [];
  return {
    assistant: a
      ? {
          enabled: a.enabled,
          provider: a.provider,
          model: a.model,
          baseUrl: a.baseUrl,
          hasKey: Boolean(a.apiKey),
          persona: a.persona,
          tone: a.tone,
          knowledge: a.knowledge,
          dailyLimitPerPerson: a.dailyLimitPerPerson,
        }
      : null,
    recent,
  };
}
