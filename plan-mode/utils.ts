/**
 * Plan-mode policy: bash allowlist and active-tool-set selection.
 */

import { PLAN_COMPLETE_TOOL_NAME } from "./completion-tool.ts"

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
  /\brm\b/iu,
  /\brmdir\b/iu,
  /\bmv\b/iu,
  /\bcp\b/iu,
  /\bmkdir\b/iu,
  /\btouch\b/iu,
  /\bchmod\b/iu,
  /\bchown\b/iu,
  /\bchgrp\b/iu,
  /\bln\b/iu,
  /\btee\b/iu,
  /\btruncate\b/iu,
  /\bdd\b/iu,
  /\bshred\b/iu,
  // Redirects that clobber files are destructive; /dev/null sinks (2>/dev/null) are exempt
  /(^|[^<])>(?!>|\s*\/dev\/null(?:[\s;|&]|$))/u,
  />>/u,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/iu,
  /\byarn\s+(add|remove|install|publish)/iu,
  /\bpnpm\s+(add|remove|install|publish)/iu,
  /\bpip\s+(install|uninstall)/iu,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/iu,
  /\bbrew\s+(install|uninstall|upgrade)/iu,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/iu,
  /\bsudo\b/iu,
  /\bsu\b/iu,
  /\bkill\b/iu,
  /\bpkill\b/iu,
  /\bkillall\b/iu,
  /\breboot\b/iu,
  /\bshutdown\b/iu,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/iu,
  /\bservice\s+\S+\s+(start|stop|restart)/iu,
  /\b(vim?|nano|emacs|code|subl)\b/iu,
]

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
  /^\s*cat\b/u,
  /^\s*head\b/u,
  /^\s*tail\b/u,
  /^\s*less\b/u,
  /^\s*more\b/u,
  /^\s*grep\b/u,
  /^\s*find\b/u,
  /^\s*ls\b/u,
  /^\s*pwd\b/u,
  /^\s*echo\b/u,
  /^\s*printf\b/u,
  /^\s*wc\b/u,
  /^\s*sort\b/u,
  /^\s*uniq\b/u,
  /^\s*diff\b/u,
  /^\s*file\b/u,
  /^\s*stat\b/u,
  /^\s*du\b/u,
  /^\s*df\b/u,
  /^\s*tree\b/u,
  /^\s*which\b/u,
  /^\s*whereis\b/u,
  /^\s*type\b/u,
  /^\s*env\b/u,
  /^\s*printenv\b/u,
  /^\s*uname\b/u,
  /^\s*whoami\b/u,
  /^\s*id\b/u,
  /^\s*date\b/u,
  /^\s*cal\b/u,
  /^\s*uptime\b/u,
  /^\s*ps\b/u,
  /^\s*top\b/u,
  /^\s*htop\b/u,
  /^\s*free\b/u,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/iu,
  /^\s*git\s+ls-/iu,
  /^\s*go\s+doc\b/u,
  // go env -w/-u write the user env file, so only the read form passes
  /^\s*go\s+env\b(?!\s+-[wu]\b)/u,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/iu,
  /^\s*yarn\s+(list|info|why|audit)/iu,
  /^\s*node\s+--version/iu,
  /^\s*python\s+--version/iu,
  /^\s*curl\s/iu,
  /^\s*wget\s+-O\s*-/iu,
  /^\s*jq\b/u,
  /^\s*yq\b/u,
  /^\s*sed\s+-n/iu,
  /^\s*awk\b/u,
  /^\s*rg\b/u,
  /^\s*fd\b/u,
  /^\s*bat\b/u,
  /^\s*eza\b/u,
]

// First matching destructive pattern, or the absence of a safe match, formats into the block reason
export function unsafeCommandReason(command: string): string | undefined {
  const destructive = DESTRUCTIVE_PATTERNS.find((p) => p.test(command))
  if (destructive) return `destructive pattern /${destructive.source}/${destructive.flags}`
  if (!SAFE_PATTERNS.some((p) => p.test(command))) return "no safe allowlist pattern matched"
  return undefined
}

// pi auto-activates every registerTool() call with no opt-out flag, so plan_complete
// (and questionnaire, bundled in ./questionnaire.ts from pi's example)
// leaks into the active set at startup. narumiruna's required-helpers pattern keeps them
// plan-mode-only so their schemas cannot pollute normal-mode context and make the model
// think it is planning.
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/required-tools.ts
// (REQUIRED_PLAN_MODE_TOOL_NAMES, withRequiredPlanModeTools, withoutRequiredPlanModeTools)
const QUESTIONNAIRE_TOOL_NAME = "questionnaire"

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
