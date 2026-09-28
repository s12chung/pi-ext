/**
 * The plan-complete tool: identity, params/details shapes, definition, and
 * rendering. The format of the plan it carries lives in plan.ts; the staged
 * plan its execution sets lives on PlanningMode (mode.ts).
 */

import { type ToolDefinition, getMarkdownTheme } from "@earendil-works/pi-coding-agent"
import { Markdown } from "@earendil-works/pi-tui"
import { PROMPTS } from "../config.ts"
import { toolResultText } from "../session/decode.ts"
import { PLAN_COMPLETE_TOOL_NAME, PLAN_COMPLETE_VERSION } from "./names.ts"
import { validatePlan } from "./plan.ts"

// Source (adapted: plan_mode_complete/plan string → plan_complete/plan markdown
// with format validation and phase-title extraction):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
export type PlanCompletionDetails = {
  version: typeof PLAN_COMPLETE_VERSION
  source: typeof PLAN_COMPLETE_TOOL_NAME
  plan: string
}

// index.ts registers this once at startup - the helper stays in the constant
// tool set (utils/tool-set.ts), its description marks it always-available but
// for plan-mode use only, and execute stages the validated plan via its
// setPlan callback only while planning. The factory runs after the extension
// factory loaded PROMPTS, so the configured texts land in the schema.
export function completionTool(
  setPlan: (plan: string) => void,
): ToolDefinition<typeof COMPLETION_PARAMS, PlanCompletionDetails> {
  const COMPLETION_PARAMS = {
    type: "object",
    additionalProperties: false,
    required: ["plan"],
    properties: {
      plan: {
        type: "string",
        minLength: 1,
        description: PROMPTS.planFormatDescription,
      },
    },
  } as const

  return {
    name: PLAN_COMPLETE_TOOL_NAME,
    label: "Complete plan",
    description: PROMPTS.planCompleteDescription,
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
