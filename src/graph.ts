import {
  Annotation,
  StateGraph,
  START,
  END,
  MemorySaver,
  interrupt,
} from "@langchain/langgraph";
import { config } from "./config.js";
import { planner, type Plan } from "./llm.js";
import { store } from "./rag/store.js";
import { createTicket, getOrder, refundOrder, ToolError } from "./tools.js";

/**
 * State is the single object every node reads and writes. Each field declares
 * a reducer; here every field simply overwrites, except `steps`, which appends
 * so the API can show the user what the agent did.
 */
export const AgentState = Annotation.Root({
  question: Annotation<string>(),
  userId: Annotation<string>(),
  tenantId: Annotation<string>(),

  plan: Annotation<Plan | null>({ reducer: (_, b) => b, default: () => null }),
  context: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  sources: Annotation<{ ref: number; source: string; score: number }[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  answer: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  steps: Annotation<string[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
});
export type AgentStateType = typeof AgentState.State;

// ------------------------------------------------------------------- nodes

/** Work out what the user wants: a documentation answer, or an action. */
async function classify(state: AgentStateType) {
  const plan = await planner.plan(state.question);
  return { plan, steps: [`classified as ${plan.route}`] };
}

/** Retrieve supporting chunks, filtered to this tenant. */
async function retrieve(state: AgentStateType) {
  const hits = await store.search(state.question, state.tenantId);
  const relevant = hits.filter((h) => h.score >= config.RELEVANCE_THRESHOLD);

  const context = relevant
    .map((h, i) => `[${i + 1}] (${h.chunk.metadata.source})\n${h.chunk.text}`)
    .join("\n\n");

  return {
    context,
    sources: relevant.map((h, i) => ({
      ref: i + 1,
      source: h.chunk.metadata.source,
      score: Number(h.score.toFixed(3)),
    })),
    steps: [`retrieved ${relevant.length} of ${hits.length} chunks above threshold`],
  };
}

/** Generate the grounded answer, or admit there is nothing to ground it in. */
async function answerFromDocs(state: AgentStateType) {
  if (!state.context) {
    return {
      answer:
        "I could not find that in the help centre. Would you like me to raise a ticket for a human agent?",
      steps: ["no relevant context — refused to guess"],
    };
  }
  const answer = await planner.answer(state.question, state.context);
  return { answer, steps: ["answered from documentation"] };
}

/**
 * The risky branch. Anything that moves money pauses here: `interrupt()` saves
 * the graph state and throws control back to the caller. A human approves in
 * the UI, the API resumes the same thread, and `interrupt()` returns their
 * decision. Small refunds below the threshold run without a human.
 */
async function takeAction(state: AgentStateType) {
  const plan = state.plan!;
  const ctx = { userId: state.userId, tenantId: state.tenantId };

  if (plan.action === "create_ticket") {
    const result = createTicket({ orderId: plan.orderId, reason: plan.reason || state.question }, ctx);
    return { answer: result, steps: ["created a ticket"] };
  }

  if (plan.action === "refund") {
    if (!plan.orderId) {
      return {
        answer: "Which order should I refund? Please share the order ID.",
        steps: ["refund requested without an order ID"],
      };
    }

    const orderInfo = getOrder({ orderId: plan.orderId }, ctx);
    const amountPaise = plan.amountPaise ?? 0;

    if (amountPaise >= config.REFUND_APPROVAL_THRESHOLD_PAISE || amountPaise === 0) {
      // Pauses the run. Everything above is already persisted by the checkpointer.
      const decision = interrupt({
        type: "approval_required",
        action: "refund",
        orderId: plan.orderId,
        amountPaise,
        orderInfo,
        question: `Approve a refund of ₹${(amountPaise / 100).toFixed(2)} for ${plan.orderId}?`,
      });

      if (decision !== "approve") {
        return { answer: "The refund was not approved. A human agent will follow up.", steps: ["refund rejected"] };
      }
    }

    try {
      const result = refundOrder(
        {
          orderId: plan.orderId,
          amountPaise: amountPaise || 1,
          // One key per thread+order, so a retry can never refund twice.
          idempotencyKey: `${state.tenantId}:${state.userId}:${plan.orderId}:${amountPaise}`,
        },
        ctx,
      );
      return { answer: result, steps: ["refund executed"] };
    } catch (err) {
      if (err instanceof ToolError) {
        return { answer: `I could not complete that refund: ${err.message}`, steps: ["refund failed"] };
      }
      throw err;
    }
  }

  return { answer: "I am not sure what action to take here.", steps: ["no action matched"] };
}

async function outOfScope() {
  return {
    answer: "I can only help with orders, refunds and questions about our help centre.",
    steps: ["out of scope"],
  };
}

// ------------------------------------------------------------------- graph
const builder = new StateGraph(AgentState)
  .addNode("classify", classify)
  .addNode("retrieve", retrieve)
  .addNode("generate", answerFromDocs)
  .addNode("act", takeAction)
  .addNode("out_of_scope", outOfScope)
  .addEdge(START, "classify")
  .addConditionalEdges(
    "classify",
    (state: AgentStateType) => state.plan?.route ?? "answer_from_docs",
    { answer_from_docs: "retrieve", take_action: "act", out_of_scope: "out_of_scope" },
  )
  .addEdge("retrieve", "generate")
  .addEdge("generate", END)
  .addEdge("act", END)
  .addEdge("out_of_scope", END);

/**
 * MemorySaver keeps one state history per thread_id, which is what makes both
 * multi-turn memory and pause/resume work. In production this is the Postgres
 * checkpointer — same interface, survives a restart.
 */
export const graph = builder.compile({ checkpointer: new MemorySaver() });
