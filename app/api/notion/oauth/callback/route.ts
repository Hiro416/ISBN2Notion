import { NextResponse } from "next/server";
import {
  clearNotionOAuthState,
  exchangeNotionCode,
  findLibraryDatabase,
  notionRedirectUri,
  notionUserIdFromToken,
  readNotionOAuthState,
  setNotionConnection,
} from "@/app/lib/notionOAuth";
import { rateLimit } from "@/app/lib/rateLimit";

export async function GET(request: Request) {
  const redirectUrl = new URL("/", notionRedirectUri(request.url));

  try {
    const limited = rateLimit(request, "notion-oauth-callback", 20, 60 * 1000);

    if (limited) {
      return limited;
    }

    const url = new URL(request.url);
    const error = url.searchParams.get("error");

    if (error) {
      redirectUrl.searchParams.set("notion", "error");
      redirectUrl.searchParams.set("message", url.searchParams.get("error_description") || error);
      return NextResponse.redirect(redirectUrl);
    }

    const code = url.searchParams.get("code") ?? "";
    const stateValue = url.searchParams.get("state") ?? "";
    const state = await readNotionOAuthState(stateValue);

    if (!code || !state) {
      redirectUrl.searchParams.set("notion", "error");
      redirectUrl.searchParams.set("message", "Notion OAuthのstateを確認できませんでした。もう一度接続してください。");
      return NextResponse.redirect(redirectUrl);
    }

    const token = await exchangeNotionCode(code, notionRedirectUri(request.url));

    if (typeof token.access_token !== "string") {
      throw new Error("Notion OAuthのアクセストークンを取得できませんでした。");
    }

    const database = await findLibraryDatabase(token.access_token);
    const response = NextResponse.redirect(redirectUrl);
    setNotionConnection(response, {
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : "",
      botId: typeof token.bot_id === "string" ? token.bot_id : "",
      workspaceId: typeof token.workspace_id === "string" ? token.workspace_id : "",
      workspaceName: typeof token.workspace_name === "string" ? token.workspace_name : "",
      workspaceIcon: typeof token.workspace_icon === "string" ? token.workspace_icon : "",
      databaseId: database.id,
      databaseTitle: database.title,
      notionUserId: notionUserIdFromToken(token),
      createdAt: new Date().toISOString(),
    });
    clearNotionOAuthState(response);

    return response;
  } catch (error) {
    redirectUrl.searchParams.set("notion", "error");
    redirectUrl.searchParams.set("message", error instanceof Error ? error.message : "Notion OAuthの接続に失敗しました。");
    const response = NextResponse.redirect(redirectUrl);
    clearNotionOAuthState(response);
    return response;
  }
}
