/**
 * Session-memory persistence for plan mode: the plan lives in custom session
 * entries (appendEntry) - never in files - as the single source of truth.
 */

import { PLAN_COMPLETE_TOOL_NAME, planFromCompletionDetails, validPlanText } from "./completion-tool.ts";

// Source (adapted: latestPlan/activeImplementation plan strings → plan/activePlan markdown):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts
export interface PlanModeState {
	enabled: boolean;
	plan?: string;
	activePlan?: string;
	toolsBeforePlanMode?: string[];
}

type SessionEntry = {
	type?: string;
	customType?: string;
	data?: unknown;
	message?: {
		role?: string;
		toolName?: string;
		details?: unknown;
	};
};

export function restorePlanModeState(entries: unknown[]): PlanModeState {
	const branch = entries as SessionEntry[];
	let stateEntryIndex = -1;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const candidate = branch[index];
		if (candidate?.type === "custom" && candidate.customType === "plan-mode") {
			stateEntryIndex = index;
			break;
		}
	}
	const entry = branch[stateEntryIndex];
	if (!isRecord(entry?.data)) return { enabled: false };

	const enabled = entry.data.enabled === true;
	const persistedPlan = enabled ? validPlanText(entry.data.plan) : undefined;
	const recoveredPlan = enabled && !persistedPlan ? latestCompletionPlan(branch.slice(stateEntryIndex + 1)) : undefined;
	// Handoff entries carry the plan with plan mode disabled; read them only then,
	// like activeImplementation in the source.
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts (restorePlanModeState activeImplementation)
	const activePlan = enabled ? undefined : validPlanText(entry.data.activePlan);
	return {
		enabled,
		plan: persistedPlan ?? recoveredPlan,
		activePlan,
		toolsBeforePlanMode: stringArray(entry.data.toolsBeforePlanMode),
	};
}

// Recover the plan from the newest plan_complete toolResult after the state
// entry (covers a crash between the tool call and the next persist).
function latestCompletionPlan(entries: SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const message = entries[index]?.message;
		if (message?.role !== "toolResult" || message.toolName !== PLAN_COMPLETE_TOOL_NAME) continue;
		const plan = planFromCompletionDetails(message.details);
		if (plan) return plan;
	}
	return undefined;
}

function stringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item): item is string => typeof item === "string" && item.trim().length > 0)
		? value
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
