import "dotenv/config";
import { z } from "zod";

/**
 * Fail fast on bad configuration.
 * The app refuses to boot with a missing or malformed env var, instead of
 * crashing on the first request that happens to need it.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  // "mock" runs the whole agent with no API key and no network: deterministic
  // planner + hash embeddings. "openai" uses real models.
  LLM_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  CHAT_MODEL: z.string().default("gpt-4o-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  // Retrieval
  CHUNK_SIZE: z.coerce.number().int().positive().default(400),
  CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(80),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(4),
  // Below this cosine score we say "I don't know" instead of guessing.
  // Left optional because the right value depends on the embedding model —
  // real embeddings sit much higher than the hash embeddings used in mock mode.
  // Always tune this on your own questions rather than copying a number.
  RELEVANCE_THRESHOLD: z.coerce.number().min(0).max(1).optional(),

  // Any refund at or above this amount needs a human to approve it.
  REFUND_APPROVAL_THRESHOLD_PAISE: z.coerce.number().int().default(100_000),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  ...parsed.data,
  RELEVANCE_THRESHOLD:
    parsed.data.RELEVANCE_THRESHOLD ??
    (parsed.data.LLM_PROVIDER === "openai" ? 0.25 : 0.1),
};

if (config.LLM_PROVIDER === "openai" && !config.OPENAI_API_KEY) {
  console.error("LLM_PROVIDER=openai requires OPENAI_API_KEY");
  process.exit(1);
}
