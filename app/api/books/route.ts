import { NextResponse } from "next/server";
import { requireAuth } from "@/app/lib/auth";
import { isValidIsbn, normalizeIsbn } from "@/app/lib/isbn";
import { createBookPage, findBookByIsbn } from "@/app/lib/notion";
import { getNotionConnection } from "@/app/lib/notionOAuth";
import { rateLimit } from "@/app/lib/rateLimit";
import { BookCreateInput } from "@/app/lib/types";

const statuses = new Set(["Unread", "Reading", "Finished"]);
type BookStatus = "Unread" | "Reading" | "Finished";
const storages = new Set(["中野", "仙台", "電子"]);
type Storage = "中野" | "仙台" | "電子";

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

function parseStatus(value: unknown): BookStatus {
  const status = String(value);
  return statuses.has(status) ? (status as BookStatus) : "Unread";
}

function parseStorage(value: unknown): Storage {
  const storage = String(value);
  return storages.has(storage) ? (storage as Storage) : "仙台";
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, "books", 30, 60 * 1000);

    if (limited) {
      return limited;
    }

    const unauthorized = await requireAuth();

    if (unauthorized) {
      return unauthorized;
    }

    const notionConnection = await getNotionConnection();

    if (!notionConnection) {
      return NextResponse.json(
        { ok: false, error: "Notion連携が必要です。先にNotionへ接続してください。" },
        { status: 428 },
      );
    }

    const body = (await request.json()) as Partial<BookCreateInput>;
    const isbn = normalizeIsbn(String(body.isbn ?? ""));

    if (!isValidIsbn(isbn)) {
      return NextResponse.json(
        { ok: false, error: "ISBNの形式が正しくありません。登録前にISBNを確認してください。" },
        { status: 400 },
      );
    }

    if (!body.title) {
      return NextResponse.json({ ok: false, error: "タイトルが空です。" }, { status: 400 });
    }

    const existing = await findBookByIsbn(isbn, notionConnection);

    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        notionUrl: existing.url,
        message: "このISBNは既にNotionに登録済みです。",
      });
    }

    const page = await createBookPage(
      {
        title: String(body.title),
        authors: stringArray(body.authors),
        publisher: String(body.publisher ?? ""),
        publishedDate: String(body.publishedDate ?? ""),
        thumbnail: String(body.thumbnail ?? ""),
        isbn,
        whyBought: String(body.whyBought ?? ""),
        tags: stringArray(body.tags),
        storage: parseStorage(body.storage),
        status: parseStatus(body.status),
      },
      notionConnection,
    );

    return NextResponse.json({ ok: true, notionUrl: page.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notionへの登録中に問題が起きました。";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
