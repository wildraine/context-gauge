// context-gauge mod의 $.state 타입 계약
export type ContextFill = { tokens: number; window: number; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'context-gauge': { fill: ContextFill | null; isHidden: boolean }
  }
}
