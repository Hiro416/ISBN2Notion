import { NextResponse } from "next/server";
import { passwordMatches, setSessionCookie } from "@/app/lib/auth";
import { rateLimit } from "@/app/lib/rateLimit";

export async function POST(request: Request) {
  const limited = rateLimit(request, "login", 10, 60 * 1000);

  if (limited) {
    return limited;
  }

  try {
    const body = (await request.json()) as { password?: unknown };
    const password = String(body.password ?? "");

    if (!passwordMatches(password)) {
      return NextResponse.json({ ok: false, error: "合言葉が違います。" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    setSessionCookie(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "ログインに失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
