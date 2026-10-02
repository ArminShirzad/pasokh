import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { assistantInputSchema, assistantView } from "@/lib/ai/settings";

export const runtime = "nodejs";

async function ownedAccount(id: string | null, workspaceId: string) {
  if (!id) return null;
  return prisma.instagramAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
}

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const account = await ownedAccount(request.nextUrl.searchParams.get("accountId"), context.workspaceId);
  if (!account) return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });
  return NextResponse.json(await assistantView(account.id));
}

export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Only owners and admins can change this" }, { status: 403 });
  const parsed = assistantInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const input = parsed.data;
  const account = await ownedAccount(input.instagramAccountId, context.workspaceId);
  if (!account) return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });

  const existing = await prisma.aiAssistant.findUnique({ where: { instagramAccountId: account.id } });
  const apiKey = input.apiKey ? encryptToken(input.apiKey) : existing?.apiKey;
  if (!apiKey) return NextResponse.json({ error: "Enter the API key." }, { status: 400 });

  const data = {
    enabled: input.enabled,
    provider: input.provider,
    model: input.model,
    baseUrl: input.provider === "OPENAI" ? input.baseUrl ?? null : null,
    apiKey,
    persona: input.persona,
    tone: input.tone,
    knowledge: input.knowledge,
    dailyLimitPerPerson: input.dailyLimitPerPerson,
  };
  await prisma.aiAssistant.upsert({
    where: { instagramAccountId: account.id },
    create: { instagramAccountId: account.id, ...data },
    update: data,
  });
  return NextResponse.json(await assistantView(account.id));
}
