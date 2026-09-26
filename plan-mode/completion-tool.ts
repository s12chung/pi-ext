/**
 * Structured plan submission for plan mode — replaces regex extraction of
 * "Plan:" sections from assistant prose with an explicit tool call. The plan
 * is free-flow markdown; phase titles are derived from its headings.
 *
 * Also owns the planning-phase interface stored by PlanningMode (mode.ts):
 * explore → approval, advanced only by plan_complete, plus the tool's
 * registration and rendering.
 */

import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import type { Mode } from "./mode.ts";

// Source (adapted: plan_mode_complete/plan string → plan_complete/plan markdown
// with format validation and phase-title extraction):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
export const PLAN_COMPLETE_TOOL_NAME = "plan_complete";
export const PLAN_COMPLETE_VERSION = 1;
// Stated only in validation errors, never in the prompt - a mentioned count
// anchors the model into padding the plan to exactly that many phases
export const PLAN_COMPLETE_MAX_PHASES = 10;

// The phases of the planning flow, advanced by plan_complete: explore until
// the plan is submitted, approval while the menu is owed - opening the menu
// consumes the phase, so rejection simply rests back in explore
export const PLANNING_PHASES = ["explore", "approval"] as const;
export type PlanningPhase = (typeof PLANNING_PHASES)[number];

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

export interface PlanCompletedResult {
	content: Array<{ type: "text"; text: string }>;
	details: PlanCompletionDetails;
	terminate: true;
}

export function planCompleted(plan: string): PlanCompletedResult {
	return {
		content: [{ type: "text", text: `**Proposed Plan**\n\n${plan}` }],
		details: {
			version: PLAN_COMPLETE_VERSION,
			source: PLAN_COMPLETE_TOOL_NAME,
			plan,
		},
		terminate: true,
	};
}

// The phases under PlanningMode, stored by it: explore until the plan is
// submitted, approval while it awaits the menu
export abstract class PlanningPhaseState {
	abstract readonly id: PlanningPhase;
	abstract readonly plan: string | undefined;
	// explore → approval; approval re-enters approval with the refined plan
	abstract submitPlan(plan: string): PlanningPhaseState;

	// plan_complete execution shared by both phases: validate, transition,
	// build the tool result
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (registerTool: plan_mode_complete)
	completePlan(params: unknown): { next: PlanningPhaseState; result: PlanCompletedResult } {
		const parsed = normalizePlanCompletion(params);
		if (!parsed.ok) throw new Error(parsed.error);
		return { next: this.submitPlan(parsed.plan), result: planCompleted(parsed.plan) };
	}

	// Whether the agent_settled menu is owed for this phase
	shouldPromptApproval(): boolean {
		return false;
	}
}

export class ExplorePhase extends PlanningPhaseState {
	readonly id = "explore" as const;
	readonly plan: string | undefined = undefined;

	submitPlan(plan: string): PlanningPhaseState {
		return new ApprovePhase(plan);
	}
}

// Exists only while the menu is owed: promptPlanApproval rejects it back to
// explore when the menu opens
export class ApprovePhase extends PlanningPhaseState {
	readonly id = "approval" as const;
	readonly plan: string;

	constructor(plan: string) {
		super();
		this.plan = plan;
	}

	submitPlan(plan: string): PlanningPhaseState {
		return new ApprovePhase(plan);
	}

	shouldPromptApproval(): boolean {
		return true;
	}
}

export function isApprovePhase(phase: PlanningPhaseState): phase is ApprovePhase {
	return phase instanceof ApprovePhase;
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
		async execute(_toolCallId, params) {
			return currentMode().completePlan(params);
		},
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts (renderPlanModeCompletion)
		renderResult: (result: PlanCompletionRenderResult) =>
			new Markdown(planCompletionMarkdown(result), 0, 0, getMarkdownTheme()),
	});
}

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
// (PlanModeCompletionRenderResult/planModeCompletionMarkdown; the Markdown wrapper that pairs
// with this is registerCompletionTool above - plain node --test runs load the pi packages fine,
// as mode.test.ts already proves)
export type PlanCompletionRenderResult = {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
};

// Deviates from the source: no planFromCompletionDetails fallback here. pi always hands
// renderResult a populated content (AgentToolResult.content is required; thrown errors become
// text results), so that branch was unreachable in prod - details-based recovery is state.ts's
// latestCompletionPlan instead.
export function planCompletionMarkdown(result: PlanCompletionRenderResult): string {
	return result.content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
