/**
 * Session-state management for plan mode: restoring and swapping the mode
 * objects, resolving the approval menu, and persisting them to
 * custom session entries (appendEntry) - never files - as the single source
 * of truth. Restores consume decode.ts's typed view of the persisted
 * entries; the unknown payloads never leave that boundary.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { DefaultMode, type Mode, PlanningMode } from "../mode.ts"
import { errorIncludes } from "../utils/safe.ts"
import type { DecodedSession } from "./decode.ts"
import { startFreshImplementation } from "./fresh-implementation.ts"

export interface PlanModeState {
  mode: "default" | "planning"
  // While planning (approval iff present - completePlan is the only
  // plan-setter)
  plan?: string
  toolsBeforePlanMode?: string[]
}

// Source (adapted: latestPlan/activeImplementation plan strings → mode objects):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts
export function restoreMode(decoded: DecodedSession): Mode {
  const state = decoded.state
  if (state?.mode !== "planning") return new DefaultMode(state?.toolsBeforePlanMode)
  return restorePlanning(state, decoded.completionPlan)
}

function restorePlanning(state: PlanModeState, recoveredPlan: string | undefined): PlanningMode {
  const planning = new PlanningMode()
  planning.toolsBeforePlanMode = state.toolsBeforePlanMode
  // The menu is owed again after restore: it re-opens on the next settle
  planning.plan = state.plan ?? recoveredPlan
  return planning
}

// Enter the next mode's tools/UI, persist its state, and hand it back for
// the caller to install as the live mode
export function setMode(pi: ExtensionAPI, ctx: ExtensionContext, next: Mode): Mode {
  next.enter(pi, ctx)
  pi.appendEntry("plan-mode", next.toState())
  return next
}

// Choice labels are bound to constants and compared with === against the
// same constants, so a label cannot drift from the check.
// Source: https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (handlePlanApproval)
const FRESH_CHOICE = "Execute in fresh session"
const STAY_CHOICE = "Stay and refine the plan"
const EXIT_CHOICE = "Exit plan mode (plan stays in context)"

// The stale-runtime messages a menu open across a session replacement can
// throw from ctx calls
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/extension-runtime.ts (isStaleExtensionContextError)
const STALE_CTX_MESSAGES = [
  "This extension ctx is stale after session replacement or reload",
  "Extension context is no longer active",
]

// Approval picker for a completed plan. Offered with or without a
// fresh-session context - like narumiruna's ready menu, only the fresh
// handoff is gated, never the choice itself. Returns the mode to keep live:
// unchanged, or the exit choice's swapped-in default.
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled latestCommandContext ?? ctx)
export async function promptPlanApproval(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  freshContext: ExtensionCommandContext | undefined,
  mode: Mode,
): Promise<Mode> {
  if (!mode.isPlanning() || !mode.plan) return mode

  const menuPlan = mode.plan
  // Unstaging resets the approval gate - the next agent_settled (queued
  // follow-up delivered, refine turn) finds no staged plan and pops no menu,
  // instead of re-stacking the picker
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (readyPresentationIntent)
  mode.unstagePlan()

  try {
    const choice = await ctx.ui.select("Plan mode - what next?", [
      FRESH_CHOICE,
      STAY_CHOICE,
      EXIT_CHOICE,
    ])
    // Esc on the picker is a plain stay: undefined matches no choice below. The
    // explicit stay opens the refinement editor, where an empty submit stays too.
    if (choice === STAY_CHOICE) await refinePlan(pi, ctx)
    if (choice === EXIT_CHOICE) return setMode(pi, ctx, mode.next())
    if (choice === FRESH_CHOICE) await startFreshHandoff(pi, ctx, freshContext, mode, menuPlan)
  } catch (error: unknown) {
    if (!errorIncludes(error, STALE_CTX_MESSAGES)) throw error
  }
  return mode
}

async function refinePlan(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const refinement = await ctx.ui.editor("Refine the plan:", "")
  if (refinement?.trim()) pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" })
}

export async function startFreshHandoff(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  freshContext: ExtensionCommandContext | undefined,
  current: PlanningMode,
  menuPlan: string,
): Promise<void> {
  // No command context means no newSession(). Restage the plan the menu
  // consumed so /plan exec lands on a command context that starts the
  // session directly; until then a settle re-presents the menu, like a
  // session restored owing one
  if (!freshContext) {
    current.plan = menuPlan
    ctx.ui.setEditorText("/plan exec")
    ctx.ui.notify(
      "Fresh sessions can only be started from a command - /plan exec is in the editor, press Enter to start it.",
      "info",
    )
    return
  }
  pi.appendEntry("plan-mode", current.toState())
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession)
  await startFreshImplementation(freshContext, menuPlan)
}
