import { BookLookup } from "./types";

type GoogleBookItem = {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
    industryIdentifiers?: Array<{
      type?: string;
      identifier?: string;
    }>;
  };
};

type OpenLibraryBook = {
  title?: string;
  authors?: Array<{ name?: string }>;
  publishers?: Array<{ name?: string }>;
  publish_date?: string;
  cover?: {
    medium?: string;
    large?: string;
    small?: string;
  };
  identifiers?: {
    isbn_10?: string[];
    isbn_13?: string[];
  };
};

type OpenBdBook = {
  summary?: {
    isbn?: string;
    title?: string;
    volume?: string;
    series?: string;
    publisher?: string;
    pubdate?: string;
    cover?: string;
    author?: string;
  };
  onix?: {
    DescriptiveDetail?: {
      Contributor?: Array<{
        PersonName?: {
          content?: string;
        };
        PersonNameInverted?: {
          content?: string;
        };
      }>;
    };
  };
};

function chooseGoogleIsbn(item: GoogleBookItem, fallback: string): string {
  const identifiers = item.volumeInfo?.industryIdentifiers ?? [];
  return (
    identifiers.find((entry) => entry.type === "ISBN_13")?.identifier ??
    identifiers.find((entry) => entry.type === "ISBN_10")?.identifier ??
    fallback
  );
}

export async function lookupBook(isbn: string): Promise<BookLookup | null> {
  const openBdBook = await lookupOpenBd(isbn);

  if (openBdBook) {
    return openBdBook;
  }

  const ndlBook = await lookupNationalDietLibrary(isbn);

  if (ndlBook) {
    return ndlBook;
  }

  const googleBook = await lookupGoogleBooks(isbn);

  if (googleBook) {
    return googleBook;
  }

  return lookupOpenLibrary(isbn);
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function firstXmlValue(xml: string, tagName: string): string {
  const escapedTagName = tagName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTagName}>`));
  return match ? stripTags(decodeXml(match[1])) : "";
}

function allXmlValues(xml: string, tagName: string): string[] {
  const escapedTagName = tagName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const matches = xml.matchAll(new RegExp(`<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTagName}>`, "g"));

  return Array.from(matches)
    .map((match) => stripTags(decodeXml(match[1])))
    .filter(Boolean);
}

function normalizeListedIsbn(value: string, fallback: string): string {
  const normalized = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  return normalized || fallback;
}

function formatOpenBdDate(value = ""): string {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  if (/^\d{6}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}`;
  }

  return value;
}

function openBdAuthors(book: OpenBdBook): string[] {
  const contributors =
    book.onix?.DescriptiveDetail?.Contributor?.map(
      (contributor) => contributor.PersonName?.content ?? contributor.PersonNameInverted?.content ?? "",
    ).filter(Boolean) ?? [];

  if (contributors.length > 0) {
    return contributors;
  }

  return (
    book.summary?.author
      ?.split(/[、,／/]/)
      .map((author) => author.trim())
      .filter(Boolean) ?? []
  );
}

async function lookupOpenBd(isbn: string): Promise<BookLookup | null> {
  const response = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`, {
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as Array<OpenBdBook | null>;
  const book = data[0];
  const summary = book?.summary;

  if (!book || !summary?.title) {
    return null;
  }

  return {
    title: [summary.series, summary.title, summary.volume].filter(Boolean).join(" "),
    authors: openBdAuthors(book),
    publisher: summary.publisher ?? "",
    publishedDate: formatOpenBdDate(summary.pubdate),
    thumbnail: summary.cover ?? "",
    isbn: summary.isbn ?? isbn,
  };
}

async function lookupNationalDietLibrary(isbn: string): Promise<BookLookup | null> {
  const response = await fetch(`https://ndlsearch.ndl.go.jp/api/opensearch?isbn=${isbn}`, {
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    return null;
  }

  const xml = await response.text();
  const item = xml.match(/<item>[\s\S]*?<\/item>/)?.[0];

  if (!item) {
    return null;
  }

  const title = firstXmlValue(item, "dc:title") || firstXmlValue(item, "title");

  if (!title) {
    return null;
  }

  return {
    title,
    authors: allXmlValues(item, "dc:creator"),
    publisher: firstXmlValue(item, "dc:publisher"),
    publishedDate: firstXmlValue(item, "dcterms:issued") || firstXmlValue(item, "dc:date"),
    thumbnail: "",
    isbn: normalizeListedIsbn(firstXmlValue(item, "dc:identifier"), isbn),
  };
}

async function lookupGoogleBooks(isbn: string): Promise<BookLookup | null> {
  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`, {
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { totalItems?: number; items?: GoogleBookItem[] };
  const item = data.items?.[0];
  const volume = item?.volumeInfo;

  if (!item || !volume?.title) {
    return null;
  }

  return {
    title: volume.title,
    authors: volume.authors ?? [],
    publisher: volume.publisher ?? "",
    publishedDate: volume.publishedDate ?? "",
    thumbnail: (volume.imageLinks?.thumbnail ?? volume.imageLinks?.smallThumbnail ?? "").replace(
      "http://",
      "https://",
    ),
    isbn: chooseGoogleIsbn(item, isbn),
  };
}

async function lookupOpenLibrary(isbn: string): Promise<BookLookup | null> {
  const response = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
    { next: { revalidate: 86400 } },
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as Record<string, OpenLibraryBook | undefined>;
  const book = data[`ISBN:${isbn}`];

  if (!book?.title) {
    return null;
  }

  return {
    title: book.title,
    authors: book.authors?.map((author) => author.name ?? "").filter(Boolean) ?? [],
    publisher: book.publishers?.[0]?.name ?? "",
    publishedDate: book.publish_date ?? "",
    thumbnail: book.cover?.large ?? book.cover?.medium ?? book.cover?.small ?? "",
    isbn: book.identifiers?.isbn_13?.[0] ?? book.identifiers?.isbn_10?.[0] ?? isbn,
  };
}
