import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { ingestDirectory } from "./rag/ingest.js";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const chunks = await ingestDirectory(join(here, "..", "data", "kb"));
  console.log(`Ingested ${chunks} chunks from the sample knowledge base.`);

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`Listening on http://localhost:${config.PORT} (provider: ${config.LLM_PROVIDER})`);
  });

  // Finish in-flight requests on deploy instead of dropping them.
  const shutdown = () => {
    console.log("Shutting down…");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
