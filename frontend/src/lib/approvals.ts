import { useCallback, useState } from "react";
import { api, ApiError } from "./api";
import { useStore, type ChatMessage } from "./store";

/** Steps the console has already shown for the current thread. The backend's
 *  `steps` reducer appends across turns, so each response carries the whole
 *  history; we only render the new tail. */
export function seenSteps(messages: ChatMessage[]) {
  return messages.reduce((n, m) => (m.role === "agent" ? n + m.steps.length : n), 0);
}

/** Approve or reject a paused thread; keeps the queue and the console in sync. */
export function useDecide() {
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    async (threadId: string, decision: "approve" | "reject") => {
      setBusy(threadId);
      setError(null);
      try {
        const res = await api.approve(state.identity, threadId, decision);
        const failed = /could not complete/i.test(res.answer);
        dispatch({
          type: "resolveApproval",
          threadId,
          status: decision === "reject" ? "rejected" : failed ? "failed" : "approved",
          outcome: res.answer,
        });
        if (state.threadId === threadId) {
          dispatch({
            type: "message",
            message: {
              id: crypto.randomUUID(),
              role: "agent",
              text: res.answer,
              at: new Date().toISOString(),
              steps: res.steps.slice(seenSteps(state.messages)),
              sources: [],
              decision,
            },
          });
        }
        return res;
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Approval failed";
        if (e instanceof ApiError && e.status === 409) {
          // The backend no longer has this thread paused (already decided, or
          // the server restarted and the in-memory checkpointer was wiped).
          dispatch({ type: "resolveApproval", threadId, status: "failed", outcome: `${msg} (409)` });
        }
        setError(msg);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [dispatch, state.identity, state.messages, state.threadId],
  );

  return { decide, busy, error, clearError: () => setError(null) };
}
