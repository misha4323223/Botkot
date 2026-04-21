export interface AgentState {
  isRunning: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastAction: string | null;
  totalAnalyses: number;
  totalTradesExecuted: number;
  intervalId: ReturnType<typeof setInterval> | null;
}

export const agentState: AgentState = {
  isRunning: false,
  lastRunAt: null,
  nextRunAt: null,
  lastAction: null,
  totalAnalyses: 0,
  totalTradesExecuted: 0,
  intervalId: null,
};

export function getAgentStatusResponse(): {
  isRunning: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastAction: string | null;
  totalAnalyses: number;
  totalTradesExecuted: number;
} {
  return {
    isRunning: agentState.isRunning,
    lastRunAt: agentState.lastRunAt?.toISOString() ?? null,
    nextRunAt: agentState.nextRunAt?.toISOString() ?? null,
    lastAction: agentState.lastAction,
    totalAnalyses: agentState.totalAnalyses,
    totalTradesExecuted: agentState.totalTradesExecuted,
  };
}
