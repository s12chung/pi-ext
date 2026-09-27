/**
 * Structured plan submission for plan mode — replaces regex extraction of
 * "Plan:" sections from assistant prose with an explicit tool call. The plan
 * is free-flow markdown. Also owns the phases stored by PlanningMode
 * (mode.ts) and the tool's registration and rendering.
 */

import {
  type AgentToolResult,
  type ExtensionAPI,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent"
import { Markdown } from "@earendil-works/pi-tui"
import type { Static } from "typebox"
import type { Mode } from "./mode.ts"

// Source (adapted: plan_mode_complete/plan string → plan_complete/plan markdown
// with format validation and phase-title extraction):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
export const PLAN_COMPLETE_TOOL_NAME = "plan_complete"
export const PLAN_COMPLETE_VERSION = 1
// Stated only in validation errors, never in the prompt - a mentioned count
// anchors the model into padding the plan to exactly that many phases
export const PLAN_COMPLETE_MAX_PHASES = 10

// The phases of the planning flow, advanced by plan_complete: explore until
// the plan is submitted, approval while the menu is owed - opening the menu
// consumes the phase, so rejection simply rests back in explore
export type PlanningPhase = "explore" | "approval"

export type PlanCompletionDetails = {
  version: typeof PLAN_COMPLETE_VERSION
  source: typeof PLAN_COMPLETE_TOOL_NAME
  plan: string
}

export const PLAN_COMPLETE_PARAMS = {
  type: "object",
  additionalProperties: false,
  required: ["plan"],
  properties: {
    plan: {
      type: "string",
      minLength: 1,
      // Free-flow plan format (numbered markdown headings + verification) adapted
      // from opencode's plan-mode prompt (Phase 4); the count cap and
      // broad-strokes-only rule are local:
      // https://github.com/sst/opencode/blob/main/packages/opencode/src/session/prompt/plan-mode.txt
      description:
        'The decision-ready plan as free-flow markdown: numbered phase headings ("## 1. Short title"), each followed by its description. Include the paths of critical files to be modified; end with a verification phase.',
    },
  },
} as const

// The tool-call params pi hands execute, schema-validated upstream
export type PlanCompletionParams = Static<typeof PLAN_COMPLETE_PARAMS>

// A phase heading line: a markdown heading of any level, numbered, with a
// non-empty title ("## 1. Title") - only the number is captured
const PHASE_HEADING_PATTERN = /^#{1,6}\s+(\d+)[.)]\s+.+$/u

type NormalizePlanCompletionResult = { ok: true; plan: string } | { ok: false; error: string }

// Every rejection carries the format so the model can correct the plan from
// the tool error alone and resubmit
const PLAN_FORMAT_HELP =
  'Expected: numbered markdown phase headings ("## 1. Short title"), numbered sequentially from 1, each followed by its description.'

function invalidPlan(reason: string): NormalizePlanCompletionResult {
  return { ok: false, error: `${reason}. ${PLAN_FORMAT_HELP}` }
}

// Format validation for both callers: pi hands execute schema-validated
// params, and decode.ts narrows persisted session data before passing it in
export function normalizePlanCompletion(input: string): NormalizePlanCompletionResult {
  const plan = input.trim()
  if (!plan) {
    return invalidPlan("plan must be a non-empty string")
  }
  const headingNumbers = plan.split("\n").flatMap((line) => {
    const match = PHASE_HEADING_PATTERN.exec(line.trim())
    return match ? [Number(match[1])] : []
  })
  if (headingNumbers.length === 0) {
    return invalidPlan('plan must contain numbered markdown phase headings, e.g. "## 1. Title"')
  }
  if (headingNumbers.length > PLAN_COMPLETE_MAX_PHASES) {
    return invalidPlan(`plan must not exceed ${PLAN_COMPLETE_MAX_PHASES} phase headings`)
  }
  const brokenAt = headingNumbers.findIndex((number, i) => number !== i + 1)
  if (brokenAt !== -1) {
    return invalidPlan(
      `phase headings must be numbered 1..${headingNumbers.length} in order (heading ${brokenAt + 1} is numbered ${headingNumbers[brokenAt]})`,
    )
  }
  return { ok: true, plan }
}

export function planCompleted(plan: string): AgentToolResult<PlanCompletionDetails> {
  return {
    content: [{ type: "text", text: `**Proposed Plan**\n\n${plan}` }],
    details: {
      version: PLAN_COMPLETE_VERSION,
      source: PLAN_COMPLETE_TOOL_NAME,
      plan,
    },
    terminate: true,
  }
}

// The phases under PlanningMode, stored by it: explore until the plan is
// submitted, approval while it awaits the menu
export abstract class PlanningPhaseState {
  public abstract readonly id: PlanningPhase

  // Both phases advance identically: the submitted plan is owed its menu -
  // a refined plan re-enters approval with the new plan
  public submitPlan(plan: string): PlanningPhaseState {
    return new ApprovePhase(plan)
  }
}

export class ExplorePhase extends PlanningPhaseState {
  public readonly id = "explore" as const
}

// Exists only while the menu is owed: promptPlanApproval rejects it back to
// explore when the menu opens
export class ApprovePhase extends PlanningPhaseState {
  public readonly id = "approval" as const
  public readonly plan: string

  public constructor(plan: string) {
    super()
    this.plan = plan
  }
}

export function isApprovePhase(phase: PlanningPhaseState): phase is ApprovePhase {
  return phase instanceof ApprovePhase
}

// setActiveTools only toggles visibility of registered tools, so this runs
// once at startup and execute delegates to the live mode object
export function registerCompletionTool(pi: ExtensionAPI, currentMode: () => Mode): void {
  pi.registerTool({
    name: PLAN_COMPLETE_TOOL_NAME,
    label: "Complete plan",
    description:
      "Use this tool when you have completed the planning phase and are ready to submit the plan. Call this tool: after you have written a complete plan, after you have clarified any questions with the user, when you are confident that the plan is ready for implementation. Do NOT call this tool: before you have finalized the plan, if you still have unanswered questions about the implementation, if the user has indicated that they want to continue planning.",
    parameters: PLAN_COMPLETE_PARAMS,
    execute(_toolCallId, params) {
      return currentMode().completePlan(params)
    },
    // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts (renderPlanModeCompletion)
    renderResult: (result) =>
      new Markdown(planCompletionMarkdown(result), 0, 0, getMarkdownTheme()),
  })
}

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
// (planModeCompletionMarkdown; the result type is pi's AgentToolResult, and the Markdown
// wrapper that pairs with this is registerCompletionTool above - plain node --test runs load
// the pi packages fine, as mode.test.ts already proves)
//
// Deviates from the source: no planFromCompletionDetails fallback here. pi always hands
// renderResult a populated content (AgentToolResult.content is required; thrown errors become
// text results), so that branch was unreachable in prod - details-based recovery is state.ts's
// latestCompletionPlan instead.
export function planCompletionMarkdown<T>(result: AgentToolResult<T>): string {
  return result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim()
}
