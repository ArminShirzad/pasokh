import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { normalizePhone } from "@/lib/forms/answers";
import { smsConfig } from "@/lib/sms/campaigns";
import { sendSms } from "@/lib/sms/providers";

export const runtime = "nodejs";

const schema = z.object({ phone: z.string().min(1).max(40), message: z.string().trim().min(1).max(1000) });

/** One SMS to the number the owner typed, to check the panel settings. */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Only owners and admins can change this" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "That does not look like a phone number." }, { status: 400 });
  const config = await smsConfig(context.workspaceId);
  if (!config) return NextResponse.json({ error: "Set up an SMS provider first." }, { status: 400 });
  try {
    const result = await sendSms(config, [phone], parsed.data.message);
    return NextResponse.json({ success: true, id: result.ids[0], test: config.provider === "TEST" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The SMS was not sent." }, { status: 502 });
  }
}
