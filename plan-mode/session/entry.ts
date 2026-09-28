/**
 * The persisted plan-mode session entry: its typed shape (PlanModeState),
 * saving the live mode into it (saveMode), and restoring the live mode
 * objects from a decoded session (restoreMode). Restores consume decode.ts's
 * typed view of the persisted entries; the unknown payloads never leave that
 * boundary.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
// Safe cycle with mode.ts (saveMode here, its constructors there): each side
// reaches across only inside function bodies
import { DefaultMode, type Mode, PlanningMode } from "../mode.ts"
import type { DecodedSession } from "./decode.ts"

export interface PlanModeState {
  mode: "default" | "planning"
  // While planning (approval iff present - completePlan is the only
  // plan-setter)
  plan?: string
  toolsBeforePlanMode?: string[]
}

// Enter the next mode's tools/UI, save its state as a session entry, and
// hand it back for the caller to install as the live mode
export function saveMode(pi: ExtensionAPI, ctx: ExtensionContext, next: Mode): Mode {
  next.enter(pi, ctx)
  pi.appendEntry("plan-mode", next.toState())
  return next
}

// Source (adapted: latestPlan/activeImplementation plan strings → mode objects):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts
export function restoreMode(decoded: DecodedSession): Mode {
  const state = decoded.state
  if (state?.mode !== "planning") return new DefaultMode(state?.toolsBeforePlanMode)
  const planning = new PlanningMode()
  planning.toolsBeforePlanMode = state.toolsBeforePlanMode
  // The menu is owed again after restore: it re-opens on the next settle
  planning.plan = state.plan ?? decoded.completionPlan
  return planning
}
