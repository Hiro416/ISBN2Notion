export type BookLookup = {
  title: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  thumbnail: string;
  isbn: string;
};

export type BookCreateInput = BookLookup & {
  whyBought?: string;
  tags?: string[];
  storage?: "中野" | "仙台" | "電子";
  status?: "Unread" | "Reading" | "Finished";
};

export type EbookEmailBookDraft = {
  title: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  thumbnail: string;
  isbn: string;
  whyBought: string;
  tags: string[];
  vendor: string;
  purchaseDate: string;
};
