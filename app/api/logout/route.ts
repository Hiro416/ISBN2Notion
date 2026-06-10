import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/app/lib/auth";
import { clearNotionConnection } from "@/app/lib/notionOAuth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  clearNotionConnection(response);
  return response;
}
