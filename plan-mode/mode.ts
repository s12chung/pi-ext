/**
 * The modes as objects: index.ts stores the current one and swaps it on
 * toggle; each mode owns its tool set, UI, and event behavior.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { type PlanModeState, saveMode } from "./session/entry.ts"
import { startFreshImplementation } from "./session/fresh-implementation.ts"
import { type PlanCompletionParams } from "./tools/completion.ts"
import { normalizePlanCompletion } from "./tools/plan.ts"
import { ensureBorderTint, setPlanBorderActive } from "./ui/border-tint.ts"
import { errorIncludes } from "./utils/safe.ts"
import { getNormalModeTools, getPlanModeTools } from "./utils/tool-set.ts"

// The tool definition lives with the tool whose execution advances the phases
// (tools/completion.ts); re-exported so index.ts wires modes without importing
// completion internals
export { completionTool } from "./tools/completion.ts"

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

export type EnterOptions = { notify?: boolean }

export abstract class Mode {
  /** Apply the tool set and UI. Idempotent - the session_start restore path re-calls it. */
  public abstract enter(pi: ExtensionAPI, ctx: ExtensionContext, options?: EnterOptions): void
  /** /plan toggle successor, carrying handoff data */
  public abstract next(): Mode
  /** Persisted shape; entry.ts reconstructs the objects from it */
  public abstract toState(): PlanModeState

  /** This mode's system-prompt section content; empty string contributes no section. */
  public systemPrompt = (): string => ""
  public onAgentEnd = (_pi: ExtensionAPI): void => {}
  public shouldPromptApproval = (): boolean => false

  // Registration is split from the logic (see completionTool):
  // execute delegates here, and the base refuses outside plan mode
  public completePlan(_params: PlanCompletionParams): string {
    throw new Error("plan_complete is only available while plan mode is active")
  }

  // Narrowing predicates on the base so callers chain them off the mode
  // object; instanceof keeps each answer single-sourced - no subclass overrides
  public isPlanning = (): this is PlanningMode => this instanceof PlanningMode

  public isDefault = (): this is DefaultMode => this instanceof DefaultMode
}

export class DefaultMode extends Mode {
  public readonly toolsBeforePlanMode: string[] | undefined

  public constructor(toolsBeforePlanMode?: string[]) {
    super()
    this.toolsBeforePlanMode = toolsBeforePlanMode
  }

  public enter(pi: ExtensionAPI, ctx: ExtensionContext, options?: EnterOptions): void {
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
    ctx.ui.setStatus("plan-mode", undefined)
    if (options?.notify !== false) ctx.ui.notify("Plan mode disabled. Full access restored.")
  }

  public next = (): Mode => new PlanningMode()

  public toState(): PlanModeState {
    return {
      mode: "default",
      toolsBeforePlanMode: this.toolsBeforePlanMode,
    }
  }
}

export class PlanningMode extends Mode {
  // The phase is the staged plan itself: undefined explores, a string owes its
  // approval menu - plan_complete stages it, promptPlanApproval unstages it
  // back to exploring
  public plan: string | undefined
  public toolsBeforePlanMode: string[] | undefined

  public enter(pi: ExtensionAPI, ctx: ExtensionContext, options?: EnterOptions): void {
    ensureBorderTint(ctx)
    setPlanBorderActive(true)
    // Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts
    // (enablePlanModeTools/restoreNormalModeTools)
    if (this.toolsBeforePlanMode === undefined) {
      this.toolsBeforePlanMode = pi.getActiveTools()
    }
    pi.setActiveTools(getPlanModeTools(this.toolsBeforePlanMode))
    ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("mdHeading", "⏸ plan"))
    if (options?.notify !== false)
      ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.")
  }

  public next = (): Mode => new DefaultMode(this.toolsBeforePlanMode)

  public toState(): PlanModeState {
    return {
      mode: "planning",
      plan: this.plan,
      toolsBeforePlanMode: this.toolsBeforePlanMode,
    }
  }

  // Validate and advance the phase; completionTool builds the tool result
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (registerTool: plan_mode_complete)
  public completePlan(params: PlanCompletionParams): string {
    const parsed = normalizePlanCompletion(params.plan)
    if (!parsed.ok) throw new Error(parsed.error)
    this.plan = parsed.plan
    return parsed.plan
  }

  public systemPrompt = (): string => PLAN_MODE_PROMPT

  // Persist state after every planning turn (the plan itself arrives via the
  // plan_complete tool call, not prose extraction)
  public onAgentEnd = (pi: ExtensionAPI): void => pi.appendEntry("plan-mode", this.toState())

  // The agent_settled menu is owed while a plan is staged
  public shouldPromptApproval = (): boolean => this.plan !== undefined

  // Handing the plan to its approval menu unstages it: the field wipes and
  // the phase rests in explore until a refined plan re-enters approval via
  // plan_complete
  public unstagePlan(): void {
    this.plan = undefined
  }
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
// unchanged, or the exit choice's saved-in default.
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
    if (choice === EXIT_CHOICE) return saveMode(pi, ctx, mode.next())
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
