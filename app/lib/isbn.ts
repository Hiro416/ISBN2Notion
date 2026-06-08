export function normalizeIsbn(value: string): string {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) {
    return false;
  }

  const sum = isbn.split("").reduce((total, char, index) => {
    const value = char === "X" ? 10 : Number(char);
    return total + value * (10 - index);
  }, 0);

  return sum % 11 === 0;
}

function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) {
    return false;
  }

  const sum = isbn
    .slice(0, 12)
    .split("")
    .reduce((total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3), 0);
  const checkDigit = (10 - (sum % 10)) % 10;

  return checkDigit === Number(isbn[12]);
}

export function isValidIsbn(value: string): boolean {
  const isbn = normalizeIsbn(value);
  return isValidIsbn10(isbn) || isValidIsbn13(isbn);
}

export function isbnForNotion(value: string): string {
  const isbn = normalizeIsbn(value);

  if (isValidIsbn13(isbn)) {
    return isbn;
  }

  if (!isValidIsbn10(isbn)) {
    return isbn;
  }

  const body = `978${isbn.slice(0, 9)}`;
  const sum = body
    .split("")
    .reduce((total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3), 0);
  const checkDigit = (10 - (sum % 10)) % 10;

  return `${body}${checkDigit}`;
}

export function barcodeToIsbn(value: string): string {
  const normalized = normalizeIsbn(value);

  if (normalized.length === 13 && (normalized.startsWith("978") || normalized.startsWith("979"))) {
    return normalized;
  }

  return normalized;
}
