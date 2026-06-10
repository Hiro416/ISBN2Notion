import { NextResponse } from "next/server";
import { requireAuth } from "@/app/lib/auth";
import { notionClientId, notionRedirectUri, setNotionOAuthState } from "@/app/lib/notionOAuth";
import { rateLimit } from "@/app/lib/rateLimit";

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, "notion-oauth-start", 20, 60 * 1000);

    if (limited) {
      return limited;
    }

    const unauthorized = await requireAuth();

    if (unauthorized) {
      return unauthorized;
    }

    const response = NextResponse.redirect(new URL("/", request.url));
    const state = await setNotionOAuthState(response);
    const authorizeUrl = new URL("https://api.notion.com/v1/oauth/authorize");

    authorizeUrl.searchParams.set("client_id", notionClientId());
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("owner", "user");
    authorizeUrl.searchParams.set("redirect_uri", notionRedirectUri(request.url));
    authorizeUrl.searchParams.set("state", state);

    response.headers.set("Location", authorizeUrl.toString());

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notion OAuthの開始に失敗しました。";

    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
