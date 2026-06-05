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
  status?: "Unread" | "Reading" | "Finished";
};
