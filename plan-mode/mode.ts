/**
 * The modes as objects: index.ts stores the current one and swaps it on
 * toggle; each mode owns its tool set, UI, and event behavior.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { type ModeEntry } from "./session/entry.ts"
import { startFreshImplementation } from "./session/fresh-implementation.ts"
import { ensureBorderTint, setPlanBorderActive } from "./ui/border-tint.ts"
import { errorIncludes } from "./utils/safe.ts"
import { getNormalModeTools, getPlanModeTools } from "./utils/tool-set.ts"

// The tool definition lives with the tool whose execution advances the phases
// (tools/completion.ts); re-exported so index.ts wires modes without importing
// completion internals
export { completionTool } from "./tools/completion.ts"

// The status-line slot both modes write under: PlanningMode sets its label,
// DefaultMode clears it by key
const PLAN_MODE_STATUS_KEY = "plan-mode"

// The [PLAN MODE ACTIVE] prompt PlanningMode returns for its system-prompt
// section (index.ts owns the "plan-mode" key) - opencode placement: mode
// instructions ride the system prompt (persistent across turns, diffed in/out
// by pi on toggle) instead of per-run messages that accumulate one per prompt.
// Opening, read-only constraint, tradeoffs questioning, and question-or-submit
// ending adapted from opencode's plan-mode.txt and plan.txt - like opencode,
// read-only bash is soft-enforced: this prompt is the only guard.
// https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt/plan-mode.txt
const PLAN_MODE_PROMPT = `[PLAN MODE ACTIVE]
The user indicated that they do not want you to execute yet -- you MUST NOT
make any edits, run any non-readonly tools (including changing configs or
making commits), or otherwise make any changes to the system. This supersedes
any other instructions you have received. The ONLY exception: experiments
may mutate, but ONLY inside a temporary folder (e.g. under /tmp) - never the
workspace, and never as part of doing the planned work.

1. Focus on understanding the user's request and the code associated with their request
2. Use the questionnaire tool to clarify ambiguities in the user request up
   front, and ask for their opinion when weighing tradeoffs - don't make
   large assumptions about user intent

Plan format - free-flow markdown, concise enough to scan quickly, but
detailed enough to execute effectively:
- Include only your recommended approach, not all alternatives
- Break the work into a few phases, each opened by a numbered markdown
  heading ("## 1. Short title", numbered sequentially from 1) followed by
  its description
- Include the paths of critical files to be modified
- End with a verification phase describing how to test the changes
  end-to-end (run the code, run tests)

At the very end of your turn, once you have asked the user questions and
are happy with your final plan, call the plan_complete tool alone, passing the
whole plan markdown as its plan argument. This is critical - your turn should
only end with either asking the user a question or calling plan_complete. Do
not stop unless it's for these 2 reasons. Do NOT use the questionnaire tool
to ask "Is this plan okay?" - that's what plan_complete does.`

export abstract class Mode {
  /** Apply the tool set and UI. Idempotent - the session_start restore path re-calls it. */
  public abstract enter(pi: ExtensionAPI, ctx: ExtensionContext): void
  /** /plan toggle successor, carrying handoff data */
  public abstract next(): Mode
  /** Persisted shape; entry.ts reconstructs the objects from it */
  public abstract toState(): ModeEntry
  /** The toast a mode transition shows on entering this mode */
  public abstract readonly enterNotice: string

  /** This mode's system-prompt section content; empty string contributes no section. */
  public systemPrompt = (): string => ""

  public getPlan = (): string | undefined => undefined

  public isPlanning = (): this is PlanningMode => this instanceof PlanningMode
  public isDefault = (): this is DefaultMode => this instanceof DefaultMode
}

export class DefaultMode extends Mode {
  public readonly enterNotice = "Plan mode disabled."
  public readonly toolsBeforePlanMode: string[] | undefined

  public constructor(toolsBeforePlanMode?: string[]) {
    super()
    this.toolsBeforePlanMode = toolsBeforePlanMode
  }

  public enter(pi: ExtensionAPI, ctx: ExtensionContext): void {
    ensureBorderTint(ctx)
    setPlanBorderActive(false)
    // pi auto-activates newly registered tools, so plan-only helpers can pollute
    // both the pre-plan snapshot and the live set; derive rather than restore.
    // Also covers fresh sessions, where the helpers start out auto-active.
    // narumiruna hides the helpers at session start until the first plan activation.
    // Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts
    // (enablePlanModeTools/restoreNormalModeTools)
    // Source: https://github.com/narumiruna/pi-extensions/blob/e74ee843d8ad1a6ef1932922a7d8dad335b24baa/packages/pi-plan-mode/src/helper-tool-visibility.ts (reconcileInactiveState/hideIfLocked)
    pi.setActiveTools(getNormalModeTools(this.toolsBeforePlanMode ?? pi.getActiveTools()))
    ctx.ui.setStatus(PLAN_MODE_STATUS_KEY, undefined)
  }

  public next = (): Mode => new PlanningMode()

  public toState(): ModeEntry {
    return {
      mode: "default",
      toolsBeforePlanMode: this.toolsBeforePlanMode,
    }
  }
}

export class PlanningMode extends Mode {
  // The phase is the staged plan itself: undefined explores, a string owes its
  // approval menu - plan_complete stages it (a resubmit overwrites) and only
  // the exit's mode swap drops it
  public plan: string | undefined
  public toolsBeforePlanMode: string[] | undefined
  public readonly enterNotice = "Plan mode enabled."

  public enter(pi: ExtensionAPI, ctx: ExtensionContext): void {
    ensureBorderTint(ctx)
    setPlanBorderActive(true)
    // Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts
    // (enablePlanModeTools/restoreNormalModeTools)
    if (this.toolsBeforePlanMode === undefined) {
      this.toolsBeforePlanMode = pi.getActiveTools()
    }
    pi.setActiveTools(getPlanModeTools(this.toolsBeforePlanMode))
    ctx.ui.setStatus(PLAN_MODE_STATUS_KEY, ctx.ui.theme.fg("mdHeading", "⏸ plan"))
  }

  public next = (): Mode => new DefaultMode(this.toolsBeforePlanMode)

  public toState(): ModeEntry {
    return {
      mode: "planning",
      plan: this.plan,
      toolsBeforePlanMode: this.toolsBeforePlanMode,
    }
  }

  public getPlan = (): string | undefined => this.plan

  public systemPrompt = (): string => PLAN_MODE_PROMPT
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
