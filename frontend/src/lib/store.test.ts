import { describe, expect, it } from "vitest";
import { initialState, reducer, type PendingApproval } from "./store";
import { seenSteps } from "./approvals";

const approval: PendingApproval = {
  id: "m1",
  threadId: "t1",
  tenantId: "acme",
  userId: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  status: "pending",
  approval: { type: "approval_required", action: "refund", orderId: "A-1001", amountPaise: 200000, orderInfo: "x", question: "?" },
};

describe("store reducer", () => {
  it("switching identity clears the conversation", () => {
    const s = reducer(
      { ...initialState, threadId: "t", messages: [{ id: "1", role: "user", text: "hi", at: "" }] },
      { type: "identity", identity: { userId: "u2", tenantId: "acme" } },
    );
    expect(s.identity.userId).toBe("u2");
    expect(s.threadId).toBeNull();
    expect(s.messages).toHaveLength(0);
  });

  it("does not queue the same paused thread twice", () => {
    let s = reducer(initialState, { type: "addApproval", item: approval });
    s = reducer(s, { type: "addApproval", item: { ...approval, id: "m2" } });
    expect(s.approvals).toHaveLength(1);
  });

  it("resolves only the pending entry for the thread", () => {
    let s = reducer(initialState, { type: "addApproval", item: approval });
    s = reducer(s, { type: "resolveApproval", threadId: "t1", status: "approved", outcome: "Refunded" });
    expect(s.approvals[0]).toMatchObject({ status: "approved", outcome: "Refunded" });
    expect(s.approvals[0]!.decidedAt).toBeTruthy();
    s = reducer(s, { type: "clearResolved" });
    expect(s.approvals).toHaveLength(0);
  });

  it("reset keeps identity", () => {
    const s = reducer({ ...initialState, identity: { userId: "u9", tenantId: "z" }, approvals: [approval] }, { type: "reset" });
    expect(s.identity.userId).toBe("u9");
    expect(s.approvals).toHaveLength(0);
  });

  it("counts steps already shown on the thread", () => {
    expect(
      seenSteps([
        { id: "1", role: "user", text: "", at: "" },
        { id: "2", role: "agent", text: "", at: "", steps: ["a", "b", "c"], sources: [] },
        { id: "3", role: "agent", text: "", at: "", steps: ["d"], sources: [] },
      ]),
    ).toBe(4);
  });
});
