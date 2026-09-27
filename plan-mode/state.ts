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
import { ApprovePhase, isApprovePhase } from "./completion-tool.ts"
import type { DecodedSession } from "./decode.ts"
import {
  isCommandContext,
  isStaleExtensionContextError,
  startFreshImplementation,
} from "./fresh-implementation.ts"
import { DefaultMode, type EnterOptions, type Mode, PlanningMode, isPlanningMode } from "./mode.ts"

export interface PlanModeState {
  mode: "default" | "planning"
  // While planning (approval iff present - completePlan is the only
  // plan-setter); DefaultMode carries activePlan instead
  plan?: string
  // Plan handed off for execution in this session, if any
  activePlan?: string
  toolsBeforePlanMode?: string[]
}

// Source (adapted: latestPlan/activeImplementation plan strings → mode objects):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts
export function restoreMode(decoded: DecodedSession): Mode {
  const state = decoded.state
  if (state?.mode !== "planning") {
    // Handoff entries carry the plan with plan mode disabled; read it only then,
    // like activeImplementation in the source.
    // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts (restorePlanModeState activeImplementation)
    return new DefaultMode(state?.activePlan, state?.toolsBeforePlanMode)
  }
  return restorePlanning(state, decoded.completionPlan)
}

function restorePlanning(state: PlanModeState, recoveredPlan: string | undefined): PlanningMode {
  const planning = new PlanningMode()
  planning.toolsBeforePlanMode = state.toolsBeforePlanMode
  // The menu is owed again after restore: it re-opens on the next settle
  const plan = state.plan ?? recoveredPlan
  if (plan) planning.phase = new ApprovePhase(plan)
  return planning
}

// The live session slot index.ts owns: the current mode plus a counter that
// increments on session replacement, invalidating menus open across the swap
export interface ModeSlot {
  mode: Mode
  rev: number
}

// Swap the live mode: enter its tools/UI and persist its state
export function setMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  slot: ModeSlot,
  next: Mode,
  options?: EnterOptions,
): void {
  slot.mode = next
  next.enter(pi, ctx, options)
  pi.appendEntry("plan-mode", next.toState())
}

// Choice labels are bound to constants and compared with === against the
// same constants, so a label cannot drift from the check.
// Source: https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (handlePlanApproval)
const FRESH_CHOICE = "Execute in fresh session"
const STAY_CHOICE = "Stay and refine the plan"
const EXIT_CHOICE = "Exit plan mode (plan stays in context)"

// Approval picker for a completed plan. Offered with or without a
// fresh-session context - like narumiruna's ready menu, only the fresh
// handoff is gated, never the choice itself.
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled latestCommandContext ?? ctx)
export async function promptPlanApproval(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  freshContext: ExtensionCommandContext | undefined,
  slot: ModeSlot,
): Promise<void> {
  const planning = slot.mode
  if (!isPlanningMode(planning) || !planning.plan) return

  const menuRev = slot.rev
  const menuPlan = planning.plan
  // Opening the menu consumes the approval phase - a later settle (queued
  // follow-up delivered, refine turn) must not re-stack the picker, and
  // rejection simply rests back in explore
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (readyPresentationIntent)
  planning.rejectApproval()

  const choice = await ctx.ui.select("Plan mode - what next?", [
    FRESH_CHOICE,
    STAY_CHOICE,
    EXIT_CHOICE,
  ])
  if (slot.rev !== menuRev) return
  // A stale picker must not act on the replacement session's restored mode:
  // without the rev check its setMode would clobber it before enter() throws
  // on the stale runtime. A pending approval means a newer submission landed
  // while this menu was open - let that one present itself instead.
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (completedPlanIsCurrent)
  const current = slot.mode
  if (!isPlanningMode(current) || isApprovePhase(current.phase)) return
  // Esc on the picker is a plain stay: undefined matches no choice below. The
  // explicit stay opens the refinement editor, where an empty submit stays too.
  if (choice === STAY_CHOICE) await refinePlan(pi, ctx)
  if (choice === EXIT_CHOICE) setMode(pi, ctx, slot, current.next())
  if (choice === FRESH_CHOICE) {
    await startFreshHandoff(pi, ctx, freshContext, slot, current, menuPlan)
  }
}

async function refinePlan(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const refinement = await ctx.ui.editor("Refine the plan:", "")
  if (refinement?.trim()) pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" })
}

async function startFreshHandoff(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  freshContext: ExtensionCommandContext | undefined,
  slot: ModeSlot,
  current: PlanningMode,
  menuPlan: string,
): Promise<void> {
  // No command context means no newSession() (see index.ts's
  // createCommandContext note) - prefill /plan, which runs with one and
  // reopens this picker ready for the handoff
  if (!freshContext) {
    ctx.ui.setEditorText("/plan")
    ctx.ui.notify(
      "Fresh sessions can only be started from a command - /plan is in the editor, press Enter and pick fresh execution again.",
      "info",
    )
    return
  }
  pi.appendEntry("plan-mode", current.toState())
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession)
  await startFreshImplementation(freshContext, menuPlan)
}

// Present the approval menu from an event context: resolve the fresh-session
// handoff context from the latest command context, and tolerate the stale
// contexts a menu can outlive.
export async function presentApproval(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  latestCommandContext: ExtensionCommandContext | undefined,
  slot: ModeSlot,
): Promise<void> {
  // Fresh-session handoff needs a command context - agent_settled's ctx has no newSession.
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (latestCommandContext)
  const freshContext =
    latestCommandContext !== undefined && isCommandContext(latestCommandContext)
      ? latestCommandContext
      : undefined
  try {
    await promptPlanApproval(pi, ctx, freshContext, slot)
  } catch (error: unknown) {
    if (!isStaleExtensionContextError(error)) throw error
  }
}
