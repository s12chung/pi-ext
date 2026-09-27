/**
 * Active-tool-set selection: plan mode's read/write tool gating and keeping
 * the plan-only helpers out of normal mode.
 */

import { PLAN_COMPLETE_TOOL_NAME, QUESTIONNAIRE_TOOL_NAME } from "../tools/names.ts"

// pi auto-activates every registerTool() call with no opt-out flag, so plan_complete
// (and questionnaire, bundled in tools/questionnaire.ts from pi's example)
// leaks into the active set at startup. narumiruna's required-helpers pattern keeps them
// plan-mode-only so their schemas cannot pollute normal-mode context and make the model
// think it is planning.
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/required-tools.ts
// (REQUIRED_PLAN_MODE_TOOL_NAMES, withRequiredPlanModeTools, withoutRequiredPlanModeTools)

export const REQUIRED_PLAN_MODE_TOOL_NAMES = [
  QUESTIONNAIRE_TOOL_NAME,
  PLAN_COMPLETE_TOOL_NAME,
] as const

function uniqueToolNames(toolNames: string[]): string[] {
  return [...new Set(toolNames)]
}

export function withRequiredPlanModeTools(toolNames: string[]): string[] {
  return uniqueToolNames([
    ...withoutRequiredPlanModeTools(toolNames),
    QUESTIONNAIRE_TOOL_NAME,
    PLAN_COMPLETE_TOOL_NAME,
  ])
}

export function withoutRequiredPlanModeTools(toolNames: string[]): string[] {
  return toolNames.filter(
    (toolName) => toolName !== QUESTIONNAIRE_TOOL_NAME && toolName !== PLAN_COMPLETE_TOOL_NAME,
  )
}

// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts (Tools)
// questionnaire/plan_complete are owned by the required-helpers block above instead of PLAN_MODE_TOOLS
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"]
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"]
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"])
const PLAN_MANAGED_TOOLS = new Set<string>([
  ...PLAN_MODE_TOOLS,
  ...REQUIRED_PLAN_MODE_TOOL_NAMES,
  ...NORMAL_MODE_TOOLS,
])

// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts (getPlanModeTools)
// wrapped in withRequiredPlanModeTools to append the helpers in canonical order
export function getPlanModeTools(activeToolNames: string[]): string[] {
  return withRequiredPlanModeTools(
    uniqueToolNames([
      ...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
      ...PLAN_MODE_TOOLS,
    ]),
  )
}

// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts (getNormalModeTools)
// the helpers drop out because PLAN_MANAGED_TOOLS spans REQUIRED_PLAN_MODE_TOOL_NAMES
export function getNormalModeTools(activeToolNames: string[]): string[] {
  return uniqueToolNames([
    ...NORMAL_MODE_TOOLS,
    ...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
  ])
}
