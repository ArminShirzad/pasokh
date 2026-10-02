import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { createInstagramContext, getActiveStories } from "@/lib/instagram/provider";

export const runtime = "nodejs";

/** Live stories of an account, for the "reply to this story" picker. */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const account = await getWorkspaceInstagramAccount(workspaceId, request.nextUrl.searchParams.get("instagramAccountId"));
  if (!account) return NextResponse.json({ success: false, error: "Instagram account not connected." }, { status: 400 });
  try {
    const stories = await getActiveStories({ context: await createInstagramContext(account) });
    return NextResponse.json({ success: true, data: stories });
  } catch (error) {
    console.error("[Instagram Stories] Error:", error);
    return NextResponse.json({ success: false, error: "Could not load stories." }, { status: 502 });
  }
}
