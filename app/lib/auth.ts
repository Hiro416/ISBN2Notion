import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const cookieName = "books_session";
const maxAge = 60 * 60 * 24 * 60;

function appPassword(): string {
  const password = process.env.BOOKS_APP_PASSWORD;

  if (!password) {
    throw new Error("BOOKS_APP_PASSWORD が設定されていません。");
  }

  return password;
}

function sessionValue(): string {
  return createHash("sha256")
    .update(`${appPassword()}:${process.env.NOTION_DATABASE_ID ?? ""}`)
    .digest("hex");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const currentValue = cookieStore.get(cookieName)?.value;

  if (!currentValue) {
    return false;
  }

  return constantTimeEqual(currentValue, sessionValue());
}

export async function requireAuth(): Promise<NextResponse | null> {
  if (await isAuthenticated()) {
    return null;
  }

  return NextResponse.json({ ok: false, error: "ログインが必要です。" }, { status: 401 });
}

export function passwordMatches(input: string): boolean {
  return constantTimeEqual(input, appPassword());
}

export function setSessionCookie(response: NextResponse): void {
  response.cookies.set(cookieName, sessionValue(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}
