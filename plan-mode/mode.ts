/**
 * The modes as objects: index.ts stores the current one and swaps it on
 * toggle; each mode owns its UI and event behavior. Modes carry no tools -
 * utils/tool-set.ts keeps the loadout constant and index.ts gates calls, so a
 * toggle never rewrites the request's cached prefix.
 */

import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { PROMPTS } from "./config.ts"
import { type ModeEntry } from "./session/entry.ts"
import { startFreshImplementation } from "./session/fresh-implementation.ts"
import { ensureBorderTint, setPlanBorderActive } from "./ui/border-tint.ts"
import { errorIncludes } from "./utils/safe.ts"

// The tool definition lives with the tool whose execution advances the phases
// (tools/completion.ts); re-exported so index.ts wires modes without importing
// completion internals
export { completionTool } from "./tools/completion.ts"

// The status-line slot both modes write under: PlanningMode sets its label,
// DefaultMode clears it by key
const PLAN_MODE_STATUS_KEY = "plan-mode"

export abstract class Mode {
  /** Apply the UI. Idempotent - the session_start restore path re-calls it. */
  public abstract enter(ctx: ExtensionContext): void
  /** /plan toggle successor, carrying handoff data */
  public abstract next(): Mode
  /** Persisted shape; entry.ts reconstructs the objects from it */
  public abstract toEntry(): ModeEntry
  /** The toast a mode transition shows on entering this mode */
  public abstract readonly enterNotice: string
  /** This mode's system-prompt section content (session/prompt.ts); empty string leaves any section untouched */
  public systemPrompt = (): string => ""

  public getPlan = (): string | undefined => undefined

  public isPlanning = (): this is PlanningMode => this instanceof PlanningMode
  public isDefault = (): this is DefaultMode => this instanceof DefaultMode
}

export class DefaultMode extends Mode {
  public readonly enterNotice = "Plan mode disabled."

  public enter(ctx: ExtensionContext): void {
    ensureBorderTint(ctx)
    setPlanBorderActive(false)
    ctx.ui.setStatus(PLAN_MODE_STATUS_KEY, undefined)
  }

  public next = (): Mode => new PlanningMode()

  public toEntry(): ModeEntry {
    return { mode: "default" }
  }
}

export class PlanningMode extends Mode {
  // The phase is the staged plan itself: undefined explores, a string owes its
  // approval menu - plan_complete stages it (a resubmit overwrites) and only
  // the exit's mode swap drops it
  public plan: string | undefined

  public readonly enterNotice = "Plan mode enabled."

  public systemPrompt = (): string => PROMPTS.planModePrompt

  public enter(ctx: ExtensionContext): void {
    ensureBorderTint(ctx)
    setPlanBorderActive(true)
    ctx.ui.setStatus(PLAN_MODE_STATUS_KEY, ctx.ui.theme.fg("mdHeading", "⏸ plan"))
  }

  public next = (): Mode => new DefaultMode()

  public toEntry(): ModeEntry {
    return { mode: "planning", plan: this.plan }
  }

  public getPlan = (): string | undefined => this.plan
}

// Choice labels are bound to constants and compared with === against the
// same constants, so a label cannot drift from the check.
// Source: https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (handlePlanApproval)
const FRESH_CHOICE = "Execute in fresh session"
const STAY_CHOICE = "Stay in plan mode"
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
// handoff is gated, never the choice itself. Returns true on the exit
// choice (the caller swaps to default); stay, Esc, and the fresh handoff
// all keep planning.
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled latestCommandContext ?? ctx)
export async function promptPlanApproval(
  ctx: ExtensionContext,
  freshContext: ExtensionCommandContext | undefined,
  plan: string,
): Promise<boolean> {
  try {
    const choice = await ctx.ui.select("Plan mode - what next?", [
      FRESH_CHOICE,
      STAY_CHOICE,
      EXIT_CHOICE,
    ])
    // Esc is a plain stay: undefined matches no choice below
    if (choice === FRESH_CHOICE) await startFreshHandoff(ctx, freshContext, plan)
    if (choice === STAY_CHOICE) ctx.ui.notify("/plan will prompt the approval.")
    if (choice === EXIT_CHOICE) return true
  } catch (error: unknown) {
    if (!errorIncludes(error, STALE_CTX_MESSAGES)) throw error
  }
  return false
}

export async function startFreshHandoff(
  ctx: ExtensionContext,
  freshContext: ExtensionCommandContext | undefined,
  plan: string,
): Promise<void> {
  if (!freshContext) {
    ctx.ui.setEditorText("/plan exec")
    ctx.ui.notify(
      "Fresh sessions can only be started from a command - /plan exec is in the editor, press Enter to start it.",
      "info",
    )
    return
  }
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession)
  await startFreshImplementation(freshContext, plan)
}
