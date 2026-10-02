import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { complete, LlmError, LlmRateLimitError } from "@/lib/ai/llm";
import { cleanAnswer, systemPrompt } from "@/lib/ai/prompt";

export const runtime = "nodejs";

const schema = z.object({ instagramAccountId: z.string().min(1), question: z.string().trim().min(1).max(1000) });

/** Asks the saved assistant a question and returns its answer; nothing goes to Instagram. */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const assistant = await prisma.aiAssistant.findFirst({
    where: { instagramAccountId: parsed.data.instagramAccountId, instagramAccount: { workspaceId: context.workspaceId } },
    include: { instagramAccount: { select: { username: true } } },
  });
  if (!assistant) return NextResponse.json({ error: "Save the assistant first." }, { status: 404 });
  try {
    const answer = await complete(
      { provider: assistant.provider === "OPENAI" ? "OPENAI" : "ANTHROPIC", model: assistant.model, baseUrl: assistant.baseUrl, apiKey: decryptToken(assistant.apiKey) },
      systemPrompt({ username: assistant.instagramAccount.username, persona: assistant.persona, tone: assistant.tone, knowledge: assistant.knowledge }),
      [{ role: "user", content: parsed.data.question }],
    );
    return NextResponse.json({ answer: cleanAnswer(answer) });
  } catch (error) {
    const message = error instanceof LlmError || error instanceof LlmRateLimitError ? error.message : "The AI request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
