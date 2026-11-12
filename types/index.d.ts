// context-gauge mod의 $.state 타입 계약
export type ContextFill = { tokens: number; window: number; percent: number }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type ChecklistLine = { depth: number; text: string; kind: 'heading' | 'done' | 'open' }
export type Checklist = { done: number; total: number; next: string | null; nextIndex: number; lines: ChecklistLine[] }

declare module 'claude-code' {
  interface PluginState {
    'context-gauge': {
      fill: ContextFill | null
      history: number[]
      limits: Limit[]
      now: number
      isHidden: boolean
      handoffSent: boolean
      handoffTurn: string | null
      checklist: Checklist | null
    }
  }
}
