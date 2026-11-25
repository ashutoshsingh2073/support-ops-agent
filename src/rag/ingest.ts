import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { store, type Chunk } from "./store.js";

/**
 * Split on paragraph boundaries first and only fall back to hard slicing, so a
 * chunk usually holds one complete idea. Overlap keeps a sentence that straddles
 * a boundary retrievable from both sides.
 */
export function chunkText(
  text: string,
  size = config.CHUNK_SIZE,
  overlap = config.CHUNK_OVERLAP,
): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > size) {
      chunks.push(current);
      current = overlap > 0 ? current.slice(-overlap) + "\n\n" + para : para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
    while (current.length > size) {
      chunks.push(current.slice(0, size));
      current = current.slice(size - overlap);
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

export async function ingestText(
  source: string,
  text: string,
  tenantId: string,
): Promise<number> {
  const chunks: Chunk[] = chunkText(text).map((t, i) => ({
    id: `${createHash("sha256").update(source).digest("hex").slice(0, 8)}-${i}`,
    text: t,
    metadata: { source, tenantId },
  }));
  return store.upsert(chunks);
}

/** Load the sample knowledge base at boot so the demo works immediately. */
export async function ingestDirectory(dir: string, tenantId = "acme"): Promise<number> {
  let total = 0;
  const files = await readdir(dir);
  for (const file of files.filter((f) => f.endsWith(".md"))) {
    const text = await readFile(join(dir, file), "utf8");
    total += await ingestText(file, text, tenantId);
  }
  return total;
}
