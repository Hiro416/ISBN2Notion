import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/app/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
