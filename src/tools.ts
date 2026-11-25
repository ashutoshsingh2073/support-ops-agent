import { z } from "zod";

/**
 * Tools are plain functions. The model only ever *proposes* a call; this file
 * is where authorisation, validation, idempotency and audit logging happen.
 */

export type AuditEntry = {
  at: string;
  tenantId: string;
  userId: string;
  tool: string;
  args: unknown;
  result: string;
};

export const auditLog: AuditEntry[] = [];

// ---------------------------------------------------------------- fake data
type Order = { id: string; userId: string; totalPaise: number; status: string; refundedPaise: number };

const orders = new Map<string, Order>([
  ["A-1001", { id: "A-1001", userId: "u1", totalPaise: 250_000, status: "delivered", refundedPaise: 0 }],
  ["A-1002", { id: "A-1002", userId: "u1", totalPaise: 45_000, status: "shipped", refundedPaise: 0 }],
  ["A-2001", { id: "A-2001", userId: "u2", totalPaise: 90_000, status: "delivered", refundedPaise: 0 }],
]);

export const tickets: { id: string; userId: string; orderId: string | null; reason: string }[] = [];

// Idempotency: the same key always returns the first result, so a retried
// request (or a model that calls the tool twice) never refunds twice.
const idempotency = new Map<string, string>();

export class ToolError extends Error {}

// ---------------------------------------------------------------- the tools
export const GetOrderArgs = z.object({ orderId: z.string().min(1) });

export function getOrder(args: unknown, ctx: { userId: string; tenantId: string }): string {
  const { orderId } = GetOrderArgs.parse(args);
  const order = orders.get(orderId);
  // Authorisation is checked here, against the authenticated user — never by
  // asking the model nicely to respect ownership.
  if (!order || order.userId !== ctx.userId) {
    return `Order ${orderId} was not found for this account.`;
  }
  const result =
    `Order ${order.id}: status ${order.status}, total ₹${(order.totalPaise / 100).toFixed(2)}` +
    (order.refundedPaise ? `, already refunded ₹${(order.refundedPaise / 100).toFixed(2)}` : "");
  auditLog.push({ at: new Date().toISOString(), ...ctx, tool: "get_order", args, result });
  return result;
}

export const RefundArgs = z.object({
  orderId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});

export function refundOrder(args: unknown, ctx: { userId: string; tenantId: string }): string {
  const { orderId, amountPaise, idempotencyKey } = RefundArgs.parse(args);

  const seen = idempotency.get(idempotencyKey);
  if (seen) return seen;

  const order = orders.get(orderId);
  if (!order || order.userId !== ctx.userId) throw new ToolError(`Order ${orderId} not found.`);
  if (order.refundedPaise + amountPaise > order.totalPaise) {
    throw new ToolError("Refund amount exceeds the order total.");
  }

  order.refundedPaise += amountPaise;
  const result = `Refunded ₹${(amountPaise / 100).toFixed(2)} for order ${orderId}.`;
  idempotency.set(idempotencyKey, result);
  auditLog.push({ at: new Date().toISOString(), ...ctx, tool: "refund_order", args, result });
  return result;
}

export const CreateTicketArgs = z.object({
  orderId: z.string().nullable(),
  reason: z.string().min(1).max(500),
});

export function createTicket(args: unknown, ctx: { userId: string; tenantId: string }): string {
  const { orderId, reason } = CreateTicketArgs.parse(args);
  const id = `T-${1000 + tickets.length}`;
  tickets.push({ id, userId: ctx.userId, orderId, reason });
  const result = `Created ticket ${id}.`;
  auditLog.push({ at: new Date().toISOString(), ...ctx, tool: "create_ticket", args, result });
  return result;
}
