/**
 * The plan-complete tool: identity, params/details shapes, definition, and
 * rendering. The format of the plan it carries lives in plan.ts; the phases
 * its execution advances live in phases.ts.
 */

import { type ToolDefinition, getMarkdownTheme } from "@earendil-works/pi-coding-agent"
import { Markdown } from "@earendil-works/pi-tui"
import type { Mode } from "../mode.ts"
import { toolResultText } from "../session/decode.ts"
import { PLAN_COMPLETE_TOOL_NAME, PLAN_COMPLETE_VERSION } from "./names.ts"
import { PLAN_FORMAT_DESCRIPTION } from "./plan.ts"

// Source (adapted: plan_mode_complete/plan string → plan_complete/plan markdown
// with format validation and phase-title extraction):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
export type PlanCompletionDetails = {
  version: typeof PLAN_COMPLETE_VERSION
  source: typeof PLAN_COMPLETE_TOOL_NAME
  plan: string
}

// The tool-call params pi hands execute, schema-validated upstream (the
// schema is COMPLETION_PARAMS below)
export type PlanCompletionParams = { plan: string }

const COMPLETION_PARAMS = {
  type: "object",
  additionalProperties: false,
  required: ["plan"],
  properties: {
    plan: {
      type: "string",
      minLength: 1,
      description: PLAN_FORMAT_DESCRIPTION,
    },
  },
} as const

// setActiveTools only toggles visibility of registered tools, so index.ts
// registers this once at startup and execute delegates to the live mode object
export function completionTool(
  currentMode: () => Mode,
): ToolDefinition<typeof COMPLETION_PARAMS, PlanCompletionDetails> {
  return {
    name: PLAN_COMPLETE_TOOL_NAME,
    label: "Complete plan",
    description:
      "Use this tool when you have completed the planning phase and are ready to submit the plan. Call this tool: after you have written a complete plan, after you have clarified any questions with the user, when you are confident that the plan is ready for implementation. Do NOT call this tool: before you have finalized the plan, if you still have unanswered questions about the implementation, if the user has indicated that they want to continue planning.",
    parameters: COMPLETION_PARAMS,
    execute(_toolCallId, params) {
      const plan = currentMode().completePlan(params)
      return Promise.resolve({
        content: [{ type: "text", text: `**Proposed Plan**\n\n${plan}` }],
        details: {
          version: PLAN_COMPLETE_VERSION,
          source: PLAN_COMPLETE_TOOL_NAME,
          plan,
        },
        terminate: true,
      })
    },
    // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts (renderPlanModeCompletion)
    renderResult: (result) => new Markdown(toolResultText(result), 0, 0, getMarkdownTheme()),
  }
}
