import { isValidIsbn, isbnForNotion, normalizeIsbn } from "./isbn";
import { EbookEmailBookDraft } from "./types";

export type EbookEmailInput = {
  subject: string;
  from: string;
  forwardedBy: string;
  text: string;
  html: string;
};

type ResponsesApiOutput = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

type EbookEmailExtraction = {
  books: EbookEmailBookDraft[];
};

const emptyExtraction: EbookEmailExtraction = { books: [] };

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function emailText(input: EbookEmailInput): string {
  const body = input.text.trim() || stripHtml(input.html);

  return [`Subject: ${input.subject}`, `From: ${input.from}`, `Forwarded-By: ${input.forwardedBy}`, "", body]
    .join("\n")
    .trim();
}

export function findIsbns(value: string): string[] {
  const matches = value.match(/[0-9Xx][0-9Xx\-\s]{8,20}[0-9Xx]/g) ?? [];
  const normalized = matches.map(isbnForNotion).filter(isValidIsbn);

  return Array.from(new Set(normalized));
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

function sanitizeDraft(value: Partial<EbookEmailBookDraft>): EbookEmailBookDraft {
  return {
    title: String(value.title ?? "").trim(),
    authors: coerceStringArray(value.authors),
    publisher: String(value.publisher ?? "").trim(),
    publishedDate: String(value.publishedDate ?? "").trim(),
    thumbnail: String(value.thumbnail ?? "").trim(),
    isbn: normalizeIsbn(String(value.isbn ?? "")),
    whyBought: String(value.whyBought ?? "").trim(),
    tags: coerceStringArray(value.tags),
    vendor: String(value.vendor ?? "").trim(),
    purchaseDate: String(value.purchaseDate ?? "").trim(),
  };
}

function parseResponsesText(data: ResponsesApiOutput): string {
  if (data.output_text) {
    return data.output_text;
  }

  return (
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

export async function extractEbookEmailWithAi(input: EbookEmailInput): Promise<EbookEmailBookDraft[]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return [];
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions:
        "You extract purchased ebook details from forwarded purchase confirmation emails. Return only facts that are present in the email. Do not guess ISBNs. If an ISBN is not present, leave it empty. Tags should be short Japanese or English category labels inferred from explicit title/context.",
      input: emailText(input).slice(0, 20000),
      text: {
        format: {
          type: "json_schema",
          name: "ebook_purchase_email",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["books"],
            properties: {
              books: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "title",
                    "authors",
                    "publisher",
                    "publishedDate",
                    "thumbnail",
                    "isbn",
                    "whyBought",
                    "tags",
                    "vendor",
                    "purchaseDate",
                  ],
                  properties: {
                    title: { type: "string" },
                    authors: { type: "array", items: { type: "string" } },
                    publisher: { type: "string" },
                    publishedDate: { type: "string" },
                    thumbnail: { type: "string" },
                    isbn: { type: "string" },
                    whyBought: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    vendor: { type: "string" },
                    purchaseDate: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAIによるメール抽出に失敗しました。");
  }

  const data = (await response.json()) as ResponsesApiOutput;
  const parsed = JSON.parse(parseResponsesText(data) || JSON.stringify(emptyExtraction)) as EbookEmailExtraction;

  return parsed.books.map(sanitizeDraft).filter((book) => book.title || book.isbn);
}

export function draftFromIsbn(isbn: string): EbookEmailBookDraft {
  return sanitizeDraft({
    isbn,
    title: "",
    authors: [],
    publisher: "",
    publishedDate: "",
    thumbnail: "",
    whyBought: "",
    tags: [],
    vendor: "",
    purchaseDate: "",
  });
}
