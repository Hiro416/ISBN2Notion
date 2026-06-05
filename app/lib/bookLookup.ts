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

function chooseGoogleIsbn(item: GoogleBookItem, fallback: string): string {
  const identifiers = item.volumeInfo?.industryIdentifiers ?? [];
  return (
    identifiers.find((entry) => entry.type === "ISBN_13")?.identifier ??
    identifiers.find((entry) => entry.type === "ISBN_10")?.identifier ??
    fallback
  );
}

export async function lookupBook(isbn: string): Promise<BookLookup | null> {
  const googleBook = await lookupGoogleBooks(isbn);

  if (googleBook) {
    return googleBook;
  }

  return lookupOpenLibrary(isbn);
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
