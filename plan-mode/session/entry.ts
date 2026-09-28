/**
 * The persisted plan-mode session entry: its typed shape (ModeEntry) and the
 * restore of the live mode objects from it (restoreMode). Restores consume
 * decode.ts's typed view of the persisted entries; the unknown payloads never
 * leave that boundary.
 */

// Safe cycle with mode.ts (restoreMode here, its constructors there): each
// side reaches across only inside function bodies
import { DefaultMode, type Mode, PlanningMode } from "../mode.ts"

// Distinct from PLAN_MODE_SECTION (session/prompt.ts): this keys the persisted
// custom entry, that one keys the live system-prompt section - same string,
// different namespaces
export const PLAN_MODE_ENTRY_TYPE = "plan-mode"

export interface ModeEntry {
  mode: "default" | "planning"
  // While planning (approval iff present - index.ts's completionTool callback
  // is the only plan-setter)
  plan?: string
  toolsBeforePlanMode?: string[]
}

// Source (adapted: latestPlan/activeImplementation plan strings → mode objects):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts
export function restoreMode(state: ModeEntry | undefined): Mode {
  if (state?.mode !== "planning") return new DefaultMode(state?.toolsBeforePlanMode)
  const planning = new PlanningMode()
  planning.toolsBeforePlanMode = state.toolsBeforePlanMode
  // The menu is owed again after restore: it re-opens on the next settle
  planning.plan = state.plan
  return planning
}
