/**
 * Structured plan submission for plan mode — replaces regex extraction of
 * "Plan:" sections from assistant prose with an explicit tool call.
 */

// Source (adapted: plan_mode_complete/plan string → plan_complete/steps array):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
export const PLAN_COMPLETE_TOOL_NAME = "plan_complete";
export const PLAN_COMPLETE_VERSION = 1;
export const PLAN_COMPLETE_MAX_STEPS = 50;

export type PlanCompletionDetails = {
	version: typeof PLAN_COMPLETE_VERSION;
	source: typeof PLAN_COMPLETE_TOOL_NAME;
	steps: string[];
};

export const PLAN_COMPLETE_PARAMS = {
	type: "object",
	additionalProperties: false,
	required: ["steps"],
	properties: {
		steps: {
			type: "array",
			minItems: 1,
			maxItems: PLAN_COMPLETE_MAX_STEPS,
			items: { type: "string", minLength: 1 },
			// Step-shape guidance adapted from opencode's plan-mode prompt (Phase 4):
			// https://github.com/sst/opencode/blob/main/packages/opencode/src/session/prompt/plan-mode.txt
			description:
				"Ordered implementation steps: one coherent change per step, naming the file(s) and what changes in one or two short sentences. End with a verification step.",
		},
	},
} as const;

type NormalizePlanCompletionResult = { ok: true; steps: string[] } | { ok: false; error: string };

export function normalizePlanCompletion(input: unknown): NormalizePlanCompletionResult {
	if (!isRecord(input) || !Array.isArray(input.steps)) {
		return { ok: false, error: "steps must be an array of strings" };
	}
	const steps = input.steps.map((step) => (typeof step === "string" ? step.trim() : ""));
	if (steps.length === 0) return { ok: false, error: "steps must not be empty" };
	if (steps.length > PLAN_COMPLETE_MAX_STEPS) {
		return { ok: false, error: `steps must not exceed ${PLAN_COMPLETE_MAX_STEPS} entries` };
	}
	if (steps.some((step) => !step)) return { ok: false, error: "each step must be a non-empty string" };
	return { ok: true, steps };
}

export function stepsFromCompletionDetails(value: unknown): string[] | undefined {
	if (!isRecord(value)) return undefined;
	if (value.version !== PLAN_COMPLETE_VERSION || value.source !== PLAN_COMPLETE_TOOL_NAME) {
		return undefined;
	}
	const normalized = normalizePlanCompletion(value);
	return normalized.ok ? normalized.steps : undefined;
}

export function planCompleted(steps: string[]) {
	const list = steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
	return {
		content: [{ type: "text" as const, text: `**Proposed Plan**\n\n${list}` }],
		details: {
			version: PLAN_COMPLETE_VERSION,
			source: PLAN_COMPLETE_TOOL_NAME,
			steps,
		} satisfies PlanCompletionDetails,
		terminate: true,
	};
}

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
// (PlanModeCompletionRenderResult/planModeCompletionMarkdown; the Markdown wrapper that pairs with
// this lives in index.ts because this module must stay import-free for plain node --test runs)
export type PlanCompletionRenderResult = {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
};

export function planCompletionMarkdown(result: PlanCompletionRenderResult): string {
	const content = result.content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();
	if (content) return content;
	const steps = stepsFromCompletionDetails(result.details);
	return steps ? `**Proposed Plan**\n\n${steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
