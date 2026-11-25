/**
 * A tiny evaluation harness. The point is not the scoring maths — it is that
 * every prompt or model change is measured against a fixed dataset before it
 * ships, instead of being judged by trying two questions by hand.
 *
 * Run with:  npm run eval
 * In LangSmith this same dataset becomes an Experiment; the evaluators below
 * are the "code" evaluators, and an LLM-as-judge would be added alongside them.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { graph } from "../src/graph.js";
import { ingestDirectory } from "../src/rag/ingest.js";

type Example = {
  id: string;
  question: string;
  expectedRoute: "answer_from_docs" | "take_action" | "out_of_scope";
  mustContain?: string[];
  mustRefuse?: boolean;
};

const here = dirname(fileURLToPath(import.meta.url));

function scoreRoute(actual: string | undefined, expected: string) {
  return actual === expected ? 1 : 0;
}

function scoreGrounded(answer: string, mustContain: string[] = []) {
  if (mustContain.length === 0) return null;
  const lower = answer.toLowerCase();
  const found = mustContain.filter((t) => lower.includes(t.toLowerCase()));
  return found.length / mustContain.length;
}

function scoreRefusal(answer: string) {
  return /could not find|do not know|don't know|hand (this )?(to|off)/i.test(answer) ? 1 : 0;
}

async function main() {
  await ingestDirectory(join(here, "..", "data", "kb"));
  const examples: Example[] = JSON.parse(
    await readFile(join(here, "dataset.json"), "utf8"),
  );

  let routeTotal = 0;
  let groundedSum = 0;
  let groundedCount = 0;
  let refusalTotal = 0;
  let refusalCount = 0;
  const failures: string[] = [];

  for (const ex of examples) {
    const result = await graph.invoke(
      { question: ex.question, userId: "u1", tenantId: "acme" },
      { configurable: { thread_id: `eval-${ex.id}` } },
    );

    const routeScore = scoreRoute(result.plan?.route, ex.expectedRoute);
    routeTotal += routeScore;
    if (!routeScore) failures.push(`${ex.id}: routed to ${result.plan?.route}, expected ${ex.expectedRoute}`);

    const grounded = scoreGrounded(result.answer ?? "", ex.mustContain);
    if (grounded !== null) {
      groundedSum += grounded;
      groundedCount++;
      if (grounded < 1) failures.push(`${ex.id}: answer missed ${JSON.stringify(ex.mustContain)}`);
    }

    if (ex.mustRefuse) {
      const refusal = scoreRefusal(result.answer ?? "");
      refusalTotal += refusal;
      refusalCount++;
      if (!refusal) failures.push(`${ex.id}: should have refused but answered`);
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`);
  console.log("\nEvaluation results");
  console.log("------------------");
  console.log(`Examples         : ${examples.length}`);
  console.log(`Routing accuracy : ${pct(routeTotal, examples.length)}`);
  console.log(`Groundedness     : ${pct(groundedSum, groundedCount)}`);
  console.log(`Correct refusals : ${pct(refusalTotal, refusalCount)}`);

  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }

  // Fail CI if quality regresses.
  const routeAccuracy = routeTotal / examples.length;
  if (routeAccuracy < 0.8) {
    console.error(`\nRouting accuracy ${pct(routeTotal, examples.length)} is below the 80% threshold.`);
    process.exit(1);
  }
  console.log("\nAll thresholds met.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
