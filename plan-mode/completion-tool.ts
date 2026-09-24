/**
 * Structured plan submission for plan mode — replaces regex extraction of
 * "Plan:" sections from assistant prose with an explicit tool call. The plan
 * is free-flow markdown; phase titles are derived from its headings.
 */

// Source (adapted: plan_mode_complete/plan string → plan_complete/plan markdown
// with format validation and phase-title extraction):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
export const PLAN_COMPLETE_TOOL_NAME = "plan_complete";
export const PLAN_COMPLETE_VERSION = 1;
// Stated only in validation errors, never in the prompt - a mentioned count
// anchors the model into padding the plan to exactly that many phases
export const PLAN_COMPLETE_MAX_PHASES = 10;

export type PlanCompletionDetails = {
	version: typeof PLAN_COMPLETE_VERSION;
	source: typeof PLAN_COMPLETE_TOOL_NAME;
	plan: string;
};

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
} as const;

// A phase title line: a markdown heading of any level, numbered ("## 1. Title")
const PHASE_HEADING_PATTERN = /^#{1,6}\s+(\d+)[.)]\s+(.+?)\s*$/;

function phaseHeadings(plan: string): Array<{ number: number; title: string }> {
	return plan.split("\n").flatMap((line) => {
		const match = PHASE_HEADING_PATTERN.exec(line.trim());
		return match ? [{ number: Number(match[1]), title: match[2] }] : [];
	});
}

// The phase list is derived from the plan: just the heading titles
export function phaseTitles(plan: string): string[] {
	return phaseHeadings(plan).map((heading) => heading.title);
}

type NormalizePlanCompletionResult = { ok: true; plan: string } | { ok: false; error: string };

// Every rejection carries the format so the model can correct the plan from
// the tool error alone and resubmit
const PLAN_FORMAT_HELP =
	'Expected: numbered markdown phase headings ("## 1. Short title"), numbered sequentially from 1, each followed by its description.';

function invalidPlan(reason: string): NormalizePlanCompletionResult {
	return { ok: false, error: `${reason}. ${PLAN_FORMAT_HELP}` };
}

export function normalizePlanCompletion(input: unknown): NormalizePlanCompletionResult {
	if (!isRecord(input) || typeof input.plan !== "string" || !input.plan.trim()) {
		return invalidPlan("plan must be a non-empty string");
	}
	const plan = input.plan.trim();
	const headings = phaseHeadings(plan);
	if (headings.length === 0) {
		return invalidPlan('plan must contain numbered markdown phase headings, e.g. "## 1. Title"');
	}
	if (headings.length > PLAN_COMPLETE_MAX_PHASES) {
		return invalidPlan(`plan must not exceed ${PLAN_COMPLETE_MAX_PHASES} phase headings`);
	}
	const brokenAt = headings.findIndex((heading, i) => heading.number !== i + 1);
	if (brokenAt !== -1) {
		return invalidPlan(
			`phase headings must be numbered 1..${headings.length} in order (heading ${brokenAt + 1} is numbered ${headings[brokenAt].number})`,
		);
	}
	return { ok: true, plan };
}

export function planFromCompletionDetails(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	if (value.version !== PLAN_COMPLETE_VERSION || value.source !== PLAN_COMPLETE_TOOL_NAME) {
		return undefined;
	}
	const normalized = normalizePlanCompletion(value);
	return normalized.ok ? normalized.plan : undefined;
}

// A persisted or restored plan must still validate before it is displayed
export function validPlanText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = normalizePlanCompletion({ plan: value });
	return normalized.ok ? normalized.plan : undefined;
}

export function planCompleted(plan: string) {
	return {
		content: [{ type: "text" as const, text: `**Proposed Plan**\n\n${plan}` }],
		details: {
			version: PLAN_COMPLETE_VERSION,
			source: PLAN_COMPLETE_TOOL_NAME,
			plan,
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
	const plan = planFromCompletionDetails(result.details);
	return plan ? `**Proposed Plan**\n\n${plan}` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
