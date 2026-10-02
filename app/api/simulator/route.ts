import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { labState, runLabAction } from "@/lib/simulator/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("comment"), postId: z.string().min(1), text: z.string().trim().min(1).max(2200) }),
  z.object({ action: z.literal("live_comment"), text: z.string().trim().min(1).max(2200) }),
  z.object({ action: z.literal("dm"), text: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("tap"), payload: z.string().min(1).max(1000), title: z.string().max(80), quickReply: z.boolean().optional() }),
  z.object({ action: z.literal("story_reply"), text: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("story_mention") }),
  z.object({ action: z.literal("follow"), follows: z.boolean() }),
  z.object({ action: z.literal("reset") }),
]);

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await labState(context.workspaceId));
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  await runLabAction(context.workspaceId, parsed.data);
  return NextResponse.json(await labState(context.workspaceId));
}
