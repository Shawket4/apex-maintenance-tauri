import { create } from "zustand";

/** The AI search box's memory. It lives outside the page so that opening a
 * result and coming back shows the same question and answer — the answer
 * itself sits in the query cache under `aiSearchKey(asked)`, so nothing is
 * asked (or paid for) twice. */
interface AiSession {
  /** What is typed in the box. */
  draft: string;
  /** The question whose answer is on screen (null = nothing asked yet). */
  asked: string | null;
  setDraft: (draft: string) => void;
  ask: (question: string) => void;
  clear: () => void;
}

export const useAiSession = create<AiSession>((set) => ({
  draft: "",
  asked: null,
  setDraft: (draft) => set({ draft }),
  ask: (question) => {
    const q = question.trim();
    if (q) set({ draft: q, asked: q });
  },
  clear: () => set({ asked: null }),
}));

export const aiSearchKey = (question: string | null) => ["ai-search", question ?? ""] as const;

/** Ask from anywhere (the search palette's "ask the smart search" row);
 * the caller then navigates to /ai. */
export function askAi(question: string) {
  useAiSession.getState().ask(question);
}
