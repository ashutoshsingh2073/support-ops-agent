import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { ApprovalPayload, Identity, Source } from "./api";

/**
 * Client-side state. The backend keeps no list of paused threads, tickets or
 * ingested documents, so the UI remembers what it has seen (per browser) to
 * build the approval queue and the knowledge-base history.
 */

export type ChatMessage =
  | { id: string; role: "user"; text: string; at: string }
  | {
      id: string;
      role: "agent";
      text: string;
      at: string;
      steps: string[];
      sources: Source[];
      route?: string;
      approval?: ApprovalPayload;
      decision?: "approve" | "reject";
    }
  | { id: string; role: "error"; text: string; at: string };

export type PendingApproval = {
  /** id of the chat message that raised it (or a generated id) */
  id: string;
  threadId: string;
  tenantId: string;
  userId: string;
  approval: ApprovalPayload;
  createdAt: string;
  status: "pending" | "approved" | "rejected" | "failed";
  outcome?: string;
  decidedAt?: string;
};

export type IngestRecord = { source: string; chunks: number; chars: number; tenantId: string; at: string };

export type State = {
  identity: Identity;
  threadId: string | null;
  messages: ChatMessage[];
  approvals: PendingApproval[];
  ingests: IngestRecord[];
};

type Action =
  | { type: "identity"; identity: Identity }
  | { type: "thread"; threadId: string | null }
  | { type: "message"; message: ChatMessage }
  | { type: "patchMessage"; id: string; patch: Partial<ChatMessage> }
  | { type: "newConversation" }
  | { type: "addApproval"; item: PendingApproval }
  | { type: "resolveApproval"; threadId: string; status: PendingApproval["status"]; outcome: string }
  | { type: "clearResolved" }
  | { type: "ingest"; record: IngestRecord }
  | { type: "reset" };

const KEY = "support-ops-ui:v1";

export const initialState: State = {
  identity: { userId: "u1", tenantId: "acme" },
  threadId: null,
  messages: [],
  approvals: [],
  ingests: [],
};

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<State>;
    return { ...initialState, ...parsed };
  } catch {
    return initialState;
  }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "identity":
      // A different identity is a different conversation: the backend thread
      // was created with the old user's id baked into its state.
      return { ...state, identity: action.identity, threadId: null, messages: [] };
    case "thread":
      return { ...state, threadId: action.threadId };
    case "message":
      return { ...state, messages: [...state.messages, action.message] };
    case "patchMessage":
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.id ? ({ ...m, ...action.patch } as ChatMessage) : m)),
      };
    case "newConversation":
      return { ...state, threadId: null, messages: [] };
    case "addApproval":
      if (state.approvals.some((a) => a.threadId === action.item.threadId && a.status === "pending")) return state;
      return { ...state, approvals: [action.item, ...state.approvals] };
    case "resolveApproval":
      return {
        ...state,
        approvals: state.approvals.map((a) =>
          a.threadId === action.threadId && a.status === "pending"
            ? { ...a, status: action.status, outcome: action.outcome, decidedAt: new Date().toISOString() }
            : a,
        ),
      };
    case "clearResolved":
      return { ...state, approvals: state.approvals.filter((a) => a.status === "pending") };
    case "ingest":
      return { ...state, ingests: [action.record, ...state.ingests].slice(0, 100) };
    case "reset":
      return { ...initialState, identity: state.identity };
  }
}

type Ctx = { state: State; dispatch: React.Dispatch<Action> };
const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children, initial }: { children: ReactNode; initial?: State }) {
  const [state, dispatch] = useReducer(reducer, initial ?? null, (init) => init ?? load());
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: state just won't survive a reload */
    }
  }, [state]);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

/** Approvals visible to the current tenant. */
export function useTenantApprovals() {
  const { state } = useStore();
  return state.approvals.filter((a) => a.tenantId === state.identity.tenantId);
}

export function useUid() {
  return useCallback(() => Math.random().toString(36).slice(2, 10) + Date.now().toString(36), []);
}
