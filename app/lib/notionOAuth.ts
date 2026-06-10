import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { Client } from "@notionhq/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const connectionCookieName = "notion_oauth";
const stateCookieName = "notion_oauth_state";
const connectionMaxAge = 60 * 60 * 24 * 180;
const stateMaxAge = 60 * 10;

export type NotionConnection = {
  accessToken: string;
  refreshToken: string;
  botId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string;
  databaseId: string;
  databaseTitle: string;
  notionUserId: string;
  createdAt: string;
};

type NotionOAuthState = {
  nonce: string;
  createdAt: string;
  expiresAt: string;
};

type NotionTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  bot_id?: unknown;
  workspace_id?: unknown;
  workspace_name?: unknown;
  workspace_icon?: unknown;
  owner?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type NotionDatabaseCandidate = {
  object?: unknown;
  id?: unknown;
  title?: unknown;
  properties?: unknown;
};

type NotionSearchResponse = {
  results?: unknown;
  has_more?: unknown;
  next_cursor?: unknown;
};

function cookieSecret(): string {
  const secret = process.env.NOTION_OAUTH_COOKIE_SECRET || process.env.BOOKS_APP_PASSWORD;

  if (!secret) {
    throw new Error("NOTION_OAUTH_COOKIE_SECRET または BOOKS_APP_PASSWORD が設定されていません。");
  }

  return secret;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(cookieSecret()).digest();
}

function signingKey(): Buffer {
  return createHash("sha256").update(`state:${cookieSecret()}`).digest();
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signState(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [base64UrlEncode(iv), base64UrlEncode(tag), base64UrlEncode(encrypted)].join(".");
}

function decryptJson<T>(value: string): T | null {
  try {
    const [ivValue, tagValue, encryptedValue] = value.split(".");

    if (!ivValue || !tagValue || !encryptedValue) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), base64UrlDecode(ivValue));
    decipher.setAuthTag(base64UrlDecode(tagValue));
    const decrypted = Buffer.concat([decipher.update(base64UrlDecode(encryptedValue)), decipher.final()]);

    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function secureCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

export function notionClientId(): string {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;

  if (!clientId) {
    throw new Error("NOTION_OAUTH_CLIENT_ID が設定されていません。");
  }

  return clientId;
}

export function notionClientSecret(): string {
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;

  if (!clientSecret) {
    throw new Error("NOTION_OAUTH_CLIENT_SECRET が設定されていません。");
  }

  return clientSecret;
}

export function notionRedirectUri(requestUrl: string): string {
  return process.env.NOTION_OAUTH_REDIRECT_URI || `${new URL(requestUrl).origin}/api/notion/oauth/callback`;
}

export async function setNotionOAuthState(response: NextResponse): Promise<string> {
  const value: NotionOAuthState = {
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + stateMaxAge * 1000).toISOString(),
  };
  const payload = base64UrlEncode(Buffer.from(JSON.stringify(value), "utf8"));
  const signature = signState(payload);

  clearNotionOAuthState(response);

  return `${payload}.${signature}`;
}

export async function readNotionOAuthState(expectedState: string): Promise<NotionOAuthState | null> {
  const [payload, signature] = expectedState.split(".");

  if (!payload || !signature || !signaturesMatch(signState(payload), signature)) {
    return null;
  }

  try {
    const state = JSON.parse(base64UrlDecode(payload).toString("utf8")) as NotionOAuthState;
    const expiresAt = Date.parse(state.expiresAt);

    if (!state.nonce || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

export function clearNotionOAuthState(response: NextResponse): void {
  response.cookies.set(stateCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    maxAge: 0,
    path: "/",
  });
}

export function setNotionConnection(response: NextResponse, connection: NotionConnection): void {
  response.cookies.set(connectionCookieName, encryptJson(connection), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    maxAge: connectionMaxAge,
    path: "/",
  });
}

export function clearNotionConnection(response: NextResponse): void {
  response.cookies.set(connectionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    maxAge: 0,
    path: "/",
  });
}

export async function getNotionConnection(): Promise<NotionConnection | null> {
  const cookieStore = await cookies();
  const encrypted = cookieStore.get(connectionCookieName)?.value;

  if (!encrypted) {
    return null;
  }

  const connection = decryptJson<NotionConnection>(encrypted);

  if (!connection?.accessToken || !connection.databaseId) {
    return null;
  }

  return connection;
}

export async function exchangeNotionCode(code: string, redirectUri: string): Promise<NotionTokenResponse> {
  const credentials = Buffer.from(`${notionClientId()}:${notionClientSecret()}`).toString("base64");
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = (await response.json()) as NotionTokenResponse;

  if (!response.ok) {
    const description = String(data.error_description || data.error || "Notion OAuth token exchange failed.");
    throw new Error(description);
  }

  return data;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function propertyType(properties: Record<string, unknown>, name: string): string {
  const property = objectRecord(properties[name]);

  return typeof property?.type === "string" ? property.type : "";
}

function hasLibrarySchema(candidate: NotionDatabaseCandidate): boolean {
  const properties = objectRecord(candidate.properties);

  if (!properties) {
    return false;
  }

  return (
    propertyType(properties, "Title") === "title" &&
    propertyType(properties, "Author") === "rich_text" &&
    propertyType(properties, "Category") === "rich_text" &&
    propertyType(properties, "Cover") === "files" &&
    propertyType(properties, "ISBN") === "number" &&
    propertyType(properties, "Published") === "date" &&
    propertyType(properties, "Storage") === "select" &&
    propertyType(properties, "memo") === "rich_text" &&
    propertyType(properties, "状態") === "select"
  );
}

function databaseTitle(candidate: NotionDatabaseCandidate): string {
  if (!Array.isArray(candidate.title)) {
    return "Notion database";
  }

  const title = candidate.title
    .map((item) => objectRecord(item)?.plain_text)
    .filter((value): value is string => typeof value === "string")
    .join("");

  return title || "Notion database";
}

function ownerUserId(owner: unknown): string {
  const ownerRecord = objectRecord(owner);

  if (!ownerRecord) {
    return "";
  }

  const user = objectRecord(ownerRecord.user);

  return typeof user?.id === "string" ? user.id : "";
}

export function notionUserIdFromToken(token: NotionTokenResponse): string {
  return ownerUserId(token.owner);
}

export async function findLibraryDatabase(accessToken: string): Promise<{ id: string; title: string }> {
  const notion = new Client({ auth: accessToken });
  let cursor: string | undefined;

  do {
    const response = (await notion.search({
      filter: {
        property: "object",
        value: "database",
      },
      page_size: 100,
      start_cursor: cursor,
    })) as NotionSearchResponse;
    const results = Array.isArray(response.results) ? response.results : [];

    for (const result of results) {
      const candidate = objectRecord(result) as NotionDatabaseCandidate | null;

      if (
        candidate?.object === "database" &&
        typeof candidate.id === "string" &&
        hasLibrarySchema(candidate)
      ) {
        return {
          id: candidate.id.replaceAll("-", ""),
          title: databaseTitle(candidate),
        };
      }
    }

    cursor = typeof response.next_cursor === "string" ? response.next_cursor : undefined;
  } while (cursor);

  throw new Error(
    "ISBN2Notion用のDatabaseを見つけられませんでした。Notionの認可画面で、必要なプロパティを持つDatabaseを選択してください。",
  );
}
