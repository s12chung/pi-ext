/**
 * Plan-mode policy: bash allowlist and active-tool-set selection.
 */

import { PLAN_COMPLETE_TOOL_NAME } from "./completion-tool.ts";

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

// First matching destructive pattern, or the absence of a safe match, formats into the block reason
export function unsafeCommandReason(command: string): string | undefined {
	const destructive = DESTRUCTIVE_PATTERNS.find((p) => p.test(command));
	if (destructive) return `destructive pattern /${destructive.source}/${destructive.flags}`;
	if (!SAFE_PATTERNS.some((p) => p.test(command))) return "no safe allowlist pattern matched";
	return undefined;
}

// pi auto-activates every registerTool() call with no opt-out flag, so plan_complete
// (and questionnaire, from pi's bundled example extension examples/extensions/questionnaire.ts)
// leaks into the active set at startup. narumiruna's required-helpers pattern keeps them
// plan-mode-only so their schemas cannot pollute normal-mode context and make the model
// think it is planning.
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/required-tools.ts
// (REQUIRED_PLAN_MODE_TOOL_NAMES, withRequiredPlanModeTools, withoutRequiredPlanModeTools)
const QUESTIONNAIRE_TOOL_NAME = "questionnaire";

export const REQUIRED_PLAN_MODE_TOOL_NAMES = [QUESTIONNAIRE_TOOL_NAME, PLAN_COMPLETE_TOOL_NAME] as const;

function uniqueToolNames(toolNames: string[]): string[] {
	return [...new Set(toolNames)];
}

export function withRequiredPlanModeTools(toolNames: string[]): string[] {
	return uniqueToolNames([
		...withoutRequiredPlanModeTools(toolNames),
		QUESTIONNAIRE_TOOL_NAME,
		PLAN_COMPLETE_TOOL_NAME,
	]);
}

export function withoutRequiredPlanModeTools(toolNames: string[]): string[] {
	return toolNames.filter(
		(toolName) => toolName !== QUESTIONNAIRE_TOOL_NAME && toolName !== PLAN_COMPLETE_TOOL_NAME,
	);
}

// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts (Tools)
// questionnaire/plan_complete are owned by the required-helpers block above instead of PLAN_MODE_TOOLS
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([
	...PLAN_MODE_TOOLS,
	...REQUIRED_PLAN_MODE_TOOL_NAMES,
	...NORMAL_MODE_TOOLS,
]);

// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts (getPlanModeTools)
// wrapped in withRequiredPlanModeTools to append the helpers in canonical order
export function getPlanModeTools(activeToolNames: string[]): string[] {
	return withRequiredPlanModeTools(
		uniqueToolNames([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]),
	);
}

// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts (getNormalModeTools)
// the helpers drop out because PLAN_MANAGED_TOOLS spans REQUIRED_PLAN_MODE_TOOL_NAMES
export function getNormalModeTools(activeToolNames: string[]): string[] {
	return uniqueToolNames([
		...NORMAL_MODE_TOOLS,
		...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
	]);
}
