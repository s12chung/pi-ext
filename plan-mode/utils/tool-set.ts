/**
 * The constant session tool set: session_start reconciles pi's active loadout
 * into a byte-stable union (active tools first, then the additions in
 * canonical order) and never touches it again, so plan toggles cannot rewrite
 * the request's tool array - the first provider cache block.
 */

import { PLAN_COMPLETE_TOOL_NAME, QUESTIONNAIRE_TOOL_NAME } from "../tools/names.ts"

// pi auto-activates every registerTool() call with no opt-out flag, so the
// plan-only helpers start out active. They stay in the constant set instead of
// being hidden per mode; their descriptions mark them plan-mode only, and
// plan_complete refuses to stage outside planning.
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/required-tools.ts
// (REQUIRED_PLAN_MODE_TOOL_NAMES)
export const REQUIRED_PLAN_MODE_TOOL_NAMES = [
  QUESTIONNAIRE_TOOL_NAME,
  PLAN_COMPLETE_TOOL_NAME,
] as const

// Exploration tools pi does not enable by default; the old per-mode swap was
// the only thing adding them, and dropping them again would churn the prefix.
export const EXPLORATION_TOOL_NAMES = ["grep", "find", "ls"] as const

// The one reconcile per session: also repairs swap-era session resumes, whose
// transcripts recorded per-mode loadouts (toolsAdded on the leading system
// message) that pi restores verbatim.
export function reconcileToolSet(activeToolNames: string[]): string[] {
  return [
    ...new Set([...activeToolNames, ...EXPLORATION_TOOL_NAMES, ...REQUIRED_PLAN_MODE_TOOL_NAMES]),
  ]
}
