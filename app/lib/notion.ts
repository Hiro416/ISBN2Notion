import { Client } from "@notionhq/client";
import { BookCreateInput } from "./types";

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

function richText(content: string) {
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

function multiSelect(values: string[] = []) {
  return {
    multi_select: values
      .map((value) => value.trim())
      .filter(Boolean)
      .map((name) => ({ name })),
  };
}

export async function findBookByIsbn(isbn: string): Promise<{ url?: string } | null> {
  const result = await notionClient().databases.query({
    database_id: databaseId(),
    filter: {
      property: "ISBN",
      rich_text: {
        equals: isbn,
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
  const properties = {
    Title: {
      title: [
        {
          text: {
            content: input.title,
          },
        },
      ],
    },
    Authors: richText(input.authors.join(", ")),
    ISBN: richText(input.isbn),
    Publisher: richText(input.publisher),
    PublishedDate: richText(input.publishedDate),
    Thumbnail: {
      url: input.thumbnail || null,
    },
    Status: {
      select: {
        name: input.status ?? "Unread",
      },
    },
    Tags: multiSelect(input.tags),
    WhyBought: richText(input.whyBought ?? ""),
    RelatedProject: multiSelect(input.relatedProject),
    Rating: {
      number: typeof input.rating === "number" ? input.rating : null,
    },
  };

  const page = await notionClient().pages.create({
    parent: {
      database_id: databaseId(),
    },
    properties,
  });

  return "url" in page ? { url: page.url } : {};
}
