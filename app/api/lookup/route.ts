import { NextResponse } from "next/server";
import { requireAuth } from "@/app/lib/auth";
import { isValidIsbn, normalizeIsbn } from "@/app/lib/isbn";
import { lookupBook } from "@/app/lib/bookLookup";
import { rateLimit } from "@/app/lib/rateLimit";

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, "lookup", 60, 60 * 1000);

    if (limited) {
      return limited;
    }

    const unauthorized = await requireAuth();

    if (unauthorized) {
      return unauthorized;
    }

    const body = (await request.json()) as { isbn?: unknown };
    const isbn = normalizeIsbn(String(body.isbn ?? ""));

    if (!isValidIsbn(isbn)) {
      return NextResponse.json(
        { ok: false, error: "ISBNの形式が正しくありません。ISBN-10またはISBN-13を入力してください。" },
        { status: 400 },
      );
    }

    const book = await lookupBook(isbn);

    if (!book) {
      return NextResponse.json(
        { ok: false, error: "書誌情報が見つかりませんでした。ISBNを確認して手入力してください。" },
        { status: 404 },
      );
    }

    return NextResponse.json(book);
  } catch {
    return NextResponse.json(
      { ok: false, error: "書誌情報の取得中に問題が起きました。時間をおいてもう一度お試しください。" },
      { status: 500 },
    );
  }
}
