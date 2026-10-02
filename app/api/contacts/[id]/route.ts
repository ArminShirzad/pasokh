import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { cleanTags } from "@/lib/contacts/list";
import { normalizeEmail, normalizePhone } from "@/lib/forms/answers";

export const runtime = "nodejs";

const patchSchema = z.object({
  tags: z.array(z.string()).max(50).optional(),
  name: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const contact = await prisma.contact.findFirst({ where: { id, instagramAccount: { workspaceId: context.workspaceId } } });
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { tags, name, phone, email } = parsed.data;
  // Stored in the same form a form answer is, so search and SMS see one format.
  const cleanPhone = phone ? normalizePhone(phone) : phone;
  if (phone && !cleanPhone) return NextResponse.json({ error: "That does not look like a phone number." }, { status: 400 });
  const cleanEmail = email ? normalizeEmail(email) : email;
  if (email && !cleanEmail) return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });

  const updated = await prisma.contact.update({
    where: { id },
    data: {
      ...(tags !== undefined ? { tags: cleanTags(tags) } : {}),
      ...(name !== undefined ? { name: name?.trim() || null } : {}),
      ...(phone !== undefined ? { phone: cleanPhone || null } : {}),
      ...(email !== undefined ? { email: cleanEmail || null } : {}),
    },
  });
  return NextResponse.json({ contact: updated });
}
