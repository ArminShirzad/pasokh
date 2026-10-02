import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { iceBreakerState, iceBreakersInputSchema, saveIceBreakers } from "@/lib/ice-breakers/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = request.nextUrl.searchParams.get("accountId") ?? "";
  const account = await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId: context.workspaceId }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });
  return NextResponse.json(await iceBreakerState(account.id));
}

export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Only owners and admins can change this" }, { status: 403 });
  const parsed = iceBreakersInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;
  const account = await prisma.instagramAccount.findFirst({
    where: { id: input.instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!account) return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });
  // Each question opens a smart reply of the same account; any other would
  // be a question on Instagram that answers nothing.
  const commandIds = [...new Set(input.items.map((i) => i.commandId))];
  const found = await prisma.command.count({ where: { id: { in: commandIds }, instagramAccountId: account.id } });
  if (found !== commandIds.length) {
    return NextResponse.json({ error: "Choose a smart reply of this account for every question." }, { status: 400 });
  }
  const { pushed } = await saveIceBreakers(input);
  return NextResponse.json({ pushed, ...(await iceBreakerState(account.id)) });
}
