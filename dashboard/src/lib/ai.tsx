import { createContext, useContext } from "react";

/** Whether the server has an AI model (summaries, Ask, Refine, action-item extraction). */
export interface AiState { ready: boolean; model: string | null; speakers: boolean }
export const AI_MISSING_HINT = "Needs an AI model on the server (Models).";
export const AiContext = createContext<AiState>({ ready: false, model: null, speakers: true });
export const useAi = () => useContext(AiContext);
