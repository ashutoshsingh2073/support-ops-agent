import { config } from "../config.js";

export type Chunk = {
  id: string;
  text: string;
  metadata: { source: string; tenantId: string };
};

export type Hit = { chunk: Chunk; score: number };

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Deterministic hashing "embeddings": each token is hashed into a bucket of a
 * 256-dim vector. Not semantic — it behaves like a bag of words — but it makes
 * the whole retrieval path runnable with no API key, and the interfaces are
 * identical to the real thing.
 */
export class HashEmbedder implements Embedder {
  constructor(private dims = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const v = new Array(this.dims).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
    for (const token of tokens) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      v[Math.abs(h) % this.dims] += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

export class OpenAIEmbedder implements Embedder {
  async embed(texts: string[]): Promise<number[][]> {
    const { OpenAIEmbeddings } = await import("@langchain/openai");
    const e = new OpenAIEmbeddings({
      model: config.EMBEDDING_MODEL,
      apiKey: config.OPENAI_API_KEY,
    });
    return e.embedDocuments(texts);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are stored normalised, so the dot product is the cosine
}

/**
 * In-memory vector store. The interface is deliberately the same shape you get
 * from pgvector, so swapping it is one class:
 *
 *   SELECT id, text, metadata, 1 - (embedding <=> $1) AS score
 *   FROM chunks
 *   WHERE tenant_id = $2
 *   ORDER BY embedding <=> $1
 *   LIMIT $3;
 *
 * The tenant filter lives in the query, never in the prompt — that is what
 * stops one customer's documents leaking into another customer's answer.
 */
export class VectorStore {
  private rows: { chunk: Chunk; vector: number[] }[] = [];

  constructor(private embedder: Embedder) {}

  async upsert(chunks: Chunk[]): Promise<number> {
    if (chunks.length === 0) return 0;
    // Re-ingesting a document replaces its old chunks rather than duplicating.
    const sources = new Set(chunks.map((c) => c.metadata.source));
    this.rows = this.rows.filter((r) => !sources.has(r.chunk.metadata.source));

    const vectors = await this.embedder.embed(chunks.map((c) => c.text));
    chunks.forEach((chunk, i) => this.rows.push({ chunk, vector: vectors[i]! }));
    return chunks.length;
  }

  async search(query: string, tenantId: string, k = config.RETRIEVAL_TOP_K): Promise<Hit[]> {
    if (this.rows.length === 0) return [];
    const [q] = await this.embedder.embed([query]);
    return this.rows
      .filter((r) => r.chunk.metadata.tenantId === tenantId) // permission filter
      .map((r) => ({ chunk: r.chunk, score: cosine(q!, r.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  get size(): number {
    return this.rows.length;
  }
}

export const store = new VectorStore(
  config.LLM_PROVIDER === "openai" ? new OpenAIEmbedder() : new HashEmbedder(),
);
