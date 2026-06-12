import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  const readmePath = path.join(process.cwd(), "README.md");
  const readme = await readFile(readmePath, "utf8");

  return new Response(readme, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
