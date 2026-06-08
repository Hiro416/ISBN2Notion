import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { lookupBook } from "@/app/lib/bookLookup";
import {
  draftFromIsbn,
  emailText,
  extractEbookEmailWithAi,
  findIsbns,
  type EbookEmailInput,
} from "@/app/lib/ebookEmail";
import { isValidIsbn, isbnForNotion } from "@/app/lib/isbn";
import { createBookPage, findBookByIsbn } from "@/app/lib/notion";
import { rateLimit } from "@/app/lib/rateLimit";
import type { BookCreateInput, EbookEmailBookDraft } from "@/app/lib/types";

export const runtime = "nodejs";

type IncomingEmailBody = {
  subject?: unknown;
  from?: unknown;
  sender?: unknown;
  forwardedBy?: unknown;
  forwarded_by?: unknown;
  relayFrom?: unknown;
  relay_from?: unknown;
  text?: unknown;
  body?: unknown;
  html?: unknown;
};

type RegisteredBook = {
  title: string;
  isbn: string;
  notionUrl?: string;
  duplicate: boolean;
};

type SkippedBook = {
  title: string;
  isbn: string;
  reason: string;
};

function normalizeEmailAddress(value: string): string {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  return (match?.[0] ?? value).trim().toLowerCase();
}

function allowedSenders(): string[] {
  return (process.env.EBOOK_EMAIL_ALLOWED_SENDERS ?? "")
    .split(",")
    .map(normalizeEmailAddress)
    .filter(Boolean);
}

function ingestToken(): string {
  const token = process.env.EBOOK_EMAIL_INGEST_TOKEN;

  if (!token) {
    throw new Error("EBOOK_EMAIL_INGEST_TOKEN が設定されていません。");
  }

  return token;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function requestToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return new URL(request.url).searchParams.get("token") ?? "";
}

function requireIngestToken(request: Request): NextResponse | null {
  if (constantTimeEqual(requestToken(request), ingestToken())) {
    return null;
  }

  return NextResponse.json({ ok: false, error: "メール取り込みトークンが正しくありません。" }, { status: 401 });
}

function requireAllowedSender(email: EbookEmailInput): NextResponse | null {
  const allowed = allowedSenders();

  if (allowed.length === 0) {
    return null;
  }

  const forwardedBy = normalizeEmailAddress(email.forwardedBy);

  if (forwardedBy && allowed.includes(forwardedBy)) {
    return null;
  }

  return NextResponse.json(
    { ok: false, error: "許可されていないメールアドレスからの転送です。", forwardedBy },
    { status: 403 },
  );
}

async function parseEmailInput(request: Request): Promise<EbookEmailInput> {
  const contentType = request.headers.get("content-type") ?? "";
  const headerForwardedBy = request.headers.get("x-ebook-forwarded-by") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as IncomingEmailBody;
    const forwardedBy =
      body.forwardedBy ?? body.forwarded_by ?? body.relayFrom ?? body.relay_from ?? headerForwardedBy;

    return {
      subject: String(body.subject ?? ""),
      from: String(body.from ?? body.sender ?? ""),
      forwardedBy: String(forwardedBy ?? ""),
      text: String(body.text ?? body.body ?? ""),
      html: String(body.html ?? ""),
    };
  }

  const form = await request.formData();

  return {
    subject: String(form.get("subject") ?? ""),
    from: String(form.get("from") ?? form.get("sender") ?? ""),
    forwardedBy: String(
      form.get("forwardedBy") ??
        form.get("forwarded_by") ??
        form.get("relayFrom") ??
        form.get("relay_from") ??
        headerForwardedBy,
    ),
    text: String(form.get("text") ?? form.get("body-plain") ?? form.get("body") ?? ""),
    html: String(form.get("html") ?? form.get("body-html") ?? ""),
  };
}

function mergeDrafts(aiDrafts: EbookEmailBookDraft[], isbns: string[]): EbookEmailBookDraft[] {
  const drafts = [...aiDrafts];
  const existing = new Set(drafts.map((draft) => isbnForNotion(draft.isbn)).filter(Boolean));

  for (const isbn of isbns) {
    if (!existing.has(isbn)) {
      drafts.push(draftFromIsbn(isbn));
    }
  }

  return drafts;
}

function memoForDraft(draft: EbookEmailBookDraft): string {
  return [draft.whyBought, draft.vendor ? `購入元: ${draft.vendor}` : "", draft.purchaseDate ? `購入日: ${draft.purchaseDate}` : ""]
    .filter(Boolean)
    .join("\n");
}

function bookInputFromDraft(draft: EbookEmailBookDraft, lookup: Awaited<ReturnType<typeof lookupBook>>): BookCreateInput | null {
  const isbn = isbnForNotion(draft.isbn || lookup?.isbn || "");

  if (!isValidIsbn(isbn)) {
    return null;
  }

  const title = lookup?.title || draft.title;

  if (!title) {
    return null;
  }

  return {
    title,
    authors: lookup?.authors.length ? lookup.authors : draft.authors,
    publisher: lookup?.publisher || draft.publisher,
    publishedDate: lookup?.publishedDate || draft.publishedDate,
    thumbnail: lookup?.thumbnail || draft.thumbnail,
    isbn,
    whyBought: memoForDraft(draft),
    tags: draft.tags,
    storage: "電子",
    status: "Unread",
  };
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, "email-ebooks", 10, 60 * 1000);

    if (limited) {
      return limited;
    }

    const unauthorized = requireIngestToken(request);

    if (unauthorized) {
      return unauthorized;
    }

    const email = await parseEmailInput(request);
    const forbiddenSender = requireAllowedSender(email);

    if (forbiddenSender) {
      return forbiddenSender;
    }

    const rawEmail = emailText(email);
    const isbns = findIsbns(rawEmail);
    const aiExtraction = await extractEbookEmailWithAi(email);
    const drafts = mergeDrafts(aiExtraction.drafts, isbns);
    const registered: RegisteredBook[] = [];
    const skipped: SkippedBook[] = [];

    for (const draft of drafts) {
      const isbn = isbnForNotion(draft.isbn);

      if (!isValidIsbn(isbn)) {
        skipped.push({
          title: draft.title,
          isbn,
          reason: "有効なISBNがメール内に見つからなかったため、自動登録を保留しました。",
        });
        continue;
      }

      const existing = await findBookByIsbn(isbn);

      if (existing) {
        registered.push({
          title: draft.title,
          isbn,
          notionUrl: existing.url,
          duplicate: true,
        });
        continue;
      }

      const lookup = await lookupBook(isbn);
      const input = bookInputFromDraft({ ...draft, isbn }, lookup);

      if (!input) {
        skipped.push({
          title: draft.title,
          isbn,
          reason: "タイトルまたは書誌情報が不足しているため、登録できませんでした。",
        });
        continue;
      }

      const page = await createBookPage(input);

      registered.push({
        title: input.title,
        isbn: input.isbn,
        notionUrl: page.url,
        duplicate: false,
      });
    }

    return NextResponse.json({
      ok: true,
      registered,
      skipped,
      ai: {
        used: aiExtraction.used,
        model: aiExtraction.model,
        responseId: aiExtraction.responseId,
        skippedReason: aiExtraction.skippedReason,
        extractedDrafts: aiExtraction.drafts.length,
      },
      message:
        registered.length > 0
          ? `${registered.length}件の電子書籍をNotionに反映しました。`
          : "登録できる電子書籍は見つかりませんでした。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "電子書籍メールの取り込み中に問題が起きました。";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
