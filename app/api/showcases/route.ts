import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { presentShowcase, readShowcaseInput, showcaseData } from "@/lib/showcases/api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = request.nextUrl.searchParams.get("accountId");
  const showcases = await prisma.showcase.findMany({
    where: { workspaceId: context.workspaceId, ...(accountId ? { instagramAccountId: accountId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ showcases: showcases.map(presentShowcase) });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const read = await readShowcaseInput(request, context.workspaceId);
  if ("response" in read) return read.response;
  const showcase = await prisma.showcase.create({ data: { workspaceId: context.workspaceId, ...showcaseData(read.input) } });
  return NextResponse.json({ showcase: presentShowcase(showcase) }, { status: 201 });
}
