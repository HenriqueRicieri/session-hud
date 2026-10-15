/** The live context window, measured as /context measures it. */
export type HudCtx = {
  /** Input tokens of the last main-thread response (cache included). */
  tokens: number
  /** The window /context measures against (compaction window or the model's). */
  max: number
  /** The model's own window, as the status line's `context_window_size`. */
  modelWindow: number
  /** Where auto-compaction runs; absent when it is off. */
  compactAt?: number
}

export type HudLimit = {
  kind: string
  percent: number
  resetsAt?: string
  /** Percentage points per hour over the recent samples. */
  perHour?: number
  /** Ms until 100% at that pace, only when it lands before the reset. */
  etaMs?: number
}

export type HudSnap = {
  ctx: HudCtx | null
  limits: HudLimit[]
  /** Session total as /cost sums it; null where the host keeps no ledger. */
  usd: number | null
}

export type HudCat = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }

export type HudTokens = { input: number; cacheRead: number; cacheWrite: number; output: number }

/** One main-loop turn: the prompt it answered and what it (and its subagents) cost. */
export type HudTurn = {
  n: number
  prompt: string
  model: string
  main: HudTokens
  sub: HudTokens
  subRuns: number
  ms: number
  /** Session cost when the turn began; null when unknown. */
  usdStart: number | null
  /** Session cost growth since then, until the next turn began. */
  usd: number | null
  isOpen: boolean
  isAborted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-hud': {
      snap: HudSnap | null
      cats: HudCat[]
      turns: HudTurn[]
      isHidden: boolean
      nowMs: number
    }
  }
}
