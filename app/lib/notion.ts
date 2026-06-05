import { Client } from "@notionhq/client";
import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { BookCreateInput } from "./types";

type RichTextProperty = {
  rich_text: Array<{
    text: {
      content: string;
    };
  }>;
};

type DateProperty = {
  date: {
    start: string;
  } | null;
};

type LocalPageProperties = Record<
  string,
  | {
      title: Array<{
        text: {
          content: string;
        };
      }>;
    }
  | RichTextProperty
  | {
      files: Array<{
        name: string;
        type: "external";
        external: {
          url: string;
        };
      }>;
    }
  | {
      number: number;
    }
  | DateProperty
  | {
      select: {
        name: string;
      };
    }
>;

function databaseId(): string {
  const id = process.env.NOTION_DATABASE_ID;

  if (!id) {
    throw new Error("NOTION_DATABASE_ID が設定されていません。");
  }

  return id;
}

function notionToken(): string {
  const token = process.env.NOTION_TOKEN;

  if (!token) {
    throw new Error("NOTION_TOKEN が設定されていません。");
  }

  return token;
}

function notionClient(): Client {
  return new Client({
    auth: notionToken(),
  });
}

function richText(content: string): RichTextProperty {
  return {
    rich_text: content
      ? [
          {
            text: { content },
          },
        ]
      : [],
  };
}

function isbnNumber(isbn: string): number {
  if (!/^\d+$/.test(isbn)) {
    throw new Error("NotionのISBNプロパティがnumber型のため、数字だけのISBNのみ登録できます。");
  }

  return Number(isbn);
}

function notionDate(value: string): DateProperty {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: { start: value } };
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    return { date: { start: `${value}-01` } };
  }

  if (/^\d{4}$/.test(value)) {
    return { date: { start: `${value}-01-01` } };
  }

  if (/^\d{4}\.\d{1,2}$/.test(value)) {
    const [year, month] = value.split(".");
    return { date: { start: `${year}-${month.padStart(2, "0")}-01` } };
  }

  return { date: null };
}

export async function findBookByIsbn(isbn: string): Promise<{ url?: string } | null> {
  const result = await notionClient().databases.query({
    database_id: databaseId(),
    filter: {
      property: "ISBN",
      number: {
        equals: isbnNumber(isbn),
      },
    },
    page_size: 1,
  });

  const page = result.results[0];

  if (!page || !("url" in page)) {
    return null;
  }

  return { url: page.url };
}

export async function createBookPage(input: BookCreateInput): Promise<{ url?: string }> {
  const category = input.tags?.join(", ") ?? "";

  const properties: LocalPageProperties = {
    Title: {
      title: [
        {
          text: {
            content: input.title,
          },
        },
      ],
    },
    Author: richText(input.authors.join(", ")),
    Category: richText(category),
    Cover: {
      files: input.thumbnail
        ? [
            {
              name: "Cover",
              type: "external",
              external: {
                url: input.thumbnail,
              },
            },
          ]
        : [],
    },
    ISBN: {
      number: isbnNumber(input.isbn),
    },
    Published: notionDate(input.publishedDate),
    Storage: {
      select: {
        name: input.storage ?? "仙台",
      },
    },
    memo: richText(input.whyBought ?? ""),
    状態: {
      select: {
        name: input.status ?? "Unread",
      },
    },
  };

  const page = await notionClient().pages.create({
    parent: {
      database_id: databaseId(),
    },
    properties: properties as unknown as CreatePageParameters["properties"],
  });

  return "url" in page ? { url: page.url } : {};
}
