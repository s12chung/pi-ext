/**
 * The plan-complete tool: identity, params/details shapes, definition, and
 * rendering. The format of the plan it carries lives in plan.ts; the staged
 * plan its execution sets lives on PlanningMode (mode.ts).
 */

import { type ToolDefinition, getMarkdownTheme } from "@earendil-works/pi-coding-agent"
import { Markdown } from "@earendil-works/pi-tui"
import { toolResultText } from "../session/decode.ts"
import { PLAN_COMPLETE_TOOL_NAME, PLAN_COMPLETE_VERSION } from "./names.ts"
import { PLAN_FORMAT_DESCRIPTION, validatePlan } from "./plan.ts"

// Source (adapted: plan_mode_complete/plan string → plan_complete/plan markdown
// with format validation and phase-title extraction):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
export type PlanCompletionDetails = {
  version: typeof PLAN_COMPLETE_VERSION
  source: typeof PLAN_COMPLETE_TOOL_NAME
  plan: string
}

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

// index.ts registers this once at startup - the helper stays in the constant
// tool set (utils/tool-set.ts), its description marks it always-available but
// for plan-mode use only, and execute stages the validated plan via its
// setPlan callback only while planning
export function completionTool(
  setPlan: (plan: string) => void,
): ToolDefinition<typeof COMPLETION_PARAMS, PlanCompletionDetails> {
  return {
    name: PLAN_COMPLETE_TOOL_NAME,
    label: "Complete plan",
    // Source (adapted: plan-exit call/avoid bullets → prose description; its
    // plan-file wording is dropped since the plan is the tool call itself):
    // https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/plan-exit.txt
    description:
      "Always available, but call it ONLY while plan mode is active. Only in plan mode, call this tool: after you have written a complete plan, after you have clarified any questions with the user, when you are confident that the plan is ready for implementation. Do NOT call this tool: before you have finalized the plan, if you still have unanswered questions about the implementation, if the user has indicated that they want to continue planning.",
    parameters: COMPLETION_PARAMS,
    execute(_toolCallId, params) {
      const plan = params.plan.trim()
      // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts
      validatePlan(plan)
      setPlan(plan)
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
