import { NextResponse } from "next/server";
import { requireAuth } from "@/app/lib/auth";
import { clearNotionConnection, getNotionConnection } from "@/app/lib/notionOAuth";

export async function GET() {
  const unauthorized = await requireAuth();

  if (unauthorized) {
    return unauthorized;
  }

  const connection = await getNotionConnection();

  return NextResponse.json({
    connected: Boolean(connection),
    databaseId: connection?.databaseId ?? "",
    databaseTitle: connection?.databaseTitle ?? "",
    notionUserId: connection?.notionUserId ?? "",
    workspaceName: connection?.workspaceName ?? "",
    workspaceIcon: connection?.workspaceIcon ?? "",
  });
}

export async function POST() {
  const unauthorized = await requireAuth();

  if (unauthorized) {
    return unauthorized;
  }

  const response = NextResponse.json({ ok: true });
  clearNotionConnection(response);
  return response;
}
