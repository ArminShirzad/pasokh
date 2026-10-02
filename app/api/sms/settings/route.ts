import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";

const schema = z.object({
  provider: z.enum(["KAVENEGAR", "SMSIR", "MELIPAYAMAK", "TEST"]),
  /** Empty keeps the stored key; it is never sent back. */
  apiKey: z.string().trim().max(500).optional(),
  sender: z.string().trim().max(30).default(""),
});

function view(s: { provider: string; apiKey: string; sender: string } | null) {
  return { settings: s ? { provider: s.provider, sender: s.sender, hasKey: Boolean(s.apiKey) } : null };
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(view(await prisma.smsSettings.findUnique({ where: { workspaceId: context.workspaceId } })));
}

export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Only owners and admins can change this" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { provider, apiKey, sender } = parsed.data;

  const existing = await prisma.smsSettings.findUnique({ where: { workspaceId: context.workspaceId } });
  // A key belongs to one panel: switching panels needs that panel's key.
  const keptKey = existing && existing.provider === provider ? existing.apiKey : "";
  const storedKey = provider === "TEST" ? "" : apiKey ? encryptToken(apiKey) : keptKey;
  if (provider !== "TEST" && !storedKey) return NextResponse.json({ error: "Enter the API key." }, { status: 400 });
  if (provider !== "TEST" && provider !== "KAVENEGAR" && !sender) {
    return NextResponse.json({ error: "Enter the sender line number." }, { status: 400 });
  }
  const saved = await prisma.smsSettings.upsert({
    where: { workspaceId: context.workspaceId },
    create: { workspaceId: context.workspaceId, provider, apiKey: storedKey, sender },
    update: { provider, apiKey: storedKey, sender },
  });
  return NextResponse.json(view(saved));
}
