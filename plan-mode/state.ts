/**
 * Session-state management for plan mode: restoring and swapping the mode
 * objects, resolving the approval menu, and persisting them to
 * custom session entries (appendEntry) - never files - as the single source
 * of truth.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isApprovePhase, ApprovePhase, PLAN_COMPLETE_TOOL_NAME, planFromCompletionDetails, validPlanText, type PlanningPhase } from "./completion-tool.ts";
import { isCommandContext, isStaleExtensionContextError, startFreshImplementation } from "./fresh-implementation.ts";
import { DefaultMode, isPlanningMode, PlanningMode, type EnterOptions, type Mode } from "./mode.ts";

export interface PlanModeState {
	mode: "default" | "planning";
	// Planning-only: the phase plan_complete last advanced to (approval iff a
	// plan is present - completePlan is the only plan-setter)
	phase?: PlanningPhase;
	// While planning (approval); DefaultMode carries activePlan instead
	plan?: string;
	// Plan handed off for execution in this session, if any
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

// Source (adapted: latestPlan/activeImplementation plan strings → mode objects):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts
export function restoreMode(entries: unknown[]): Mode {
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
	if (!isRecord(entry?.data)) return new DefaultMode();

	const data = entry.data;
	// Migrate the pre-mode-objects shape (enabled boolean) alongside the current one
	if (data.mode === "planning" || data.enabled === true) {
		return restorePlanning(data, branch.slice(stateEntryIndex + 1));
	}
	// Handoff entries carry the plan with plan mode disabled; read it only then,
	// like activeImplementation in the source.
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts (restorePlanModeState activeImplementation)
	return new DefaultMode(validPlanText(data.activePlan), stringArray(data.toolsBeforePlanMode));
}

function restorePlanning(data: Record<string, unknown>, afterStateEntry: SessionEntry[]): PlanningMode {
	const persistedPlan = validPlanText(data.plan);
	const recoveredPlan = persistedPlan ?? latestCompletionPlan(afterStateEntry);
	const planning = new PlanningMode();
	planning.toolsBeforePlanMode = stringArray(data.toolsBeforePlanMode);
	// The menu is owed again after restore: it re-opens on the next settle
	if (recoveredPlan) planning.phase = new ApprovePhase(recoveredPlan);
	return planning;
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

// The live session slot index.ts owns: the current mode plus a counter that
// increments on session replacement, invalidating menus open across the swap
export interface ModeSlot {
	mode: Mode;
	rev: number;
}

// Swap the live mode: enter its tools/UI and persist its state
export function setMode(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	slot: ModeSlot,
	next: Mode,
	options?: EnterOptions,
): void {
	slot.mode = next;
	next.enter(pi, ctx, options);
	pi.appendEntry("plan-mode", next.toState());
}

// Approval picker for a completed plan. Offered with or without a
// fresh-session context - like narumiruna's ready menu, only the fresh
// handoff is gated, never the choice itself.
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled latestCommandContext ?? ctx)
export async function promptPlanApproval(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	freshContext: ExtensionCommandContext | undefined,
	slot: ModeSlot,
): Promise<void> {
	const planning = slot.mode;
	if (!isPlanningMode(planning) || !planning.plan) return;

	const menuRev = slot.rev;
	const menuPlan = planning.plan;
	// Opening the menu consumes the approval phase - a later settle (queued
	// follow-up delivered, refine turn) must not re-stack the picker, and
	// rejection simply rests back in explore
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (readyPresentationIntent)
	planning.rejectApproval();

	// Choice labels are bound to constants and compared with === against the
	// same constants, so the "(recommended)" suffix cannot drift from the check.
	// Source: https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (handlePlanApproval)
	const freshChoice = "Execute in fresh session (recommended)";
	const currentChoice = "Execute in current session";
	const stayChoice = "Stay in plan mode";
	const refineChoice = "Refine the plan";
	const exitChoice = "Exit plan mode (discard plan)";
	const choice = await ctx.ui.select("Plan mode - what next?", [
		freshChoice,
		currentChoice,
		stayChoice,
		refineChoice,
		exitChoice,
	]);
	if (slot.rev !== menuRev) return;
	// A stale picker must not act on the replacement session's restored mode:
	// without the rev check its setMode would clobber it before enter() throws
	// on the stale runtime. A pending approval means a newer submission landed
	// while this menu was open - let that one present itself instead.
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (completedPlanIsCurrent)
	const current = slot.mode;
	if (!isPlanningMode(current) || isApprovePhase(current.phase)) return;
	if (!choice || choice === stayChoice) return;

	if (choice === exitChoice) {
		setMode(pi, ctx, slot, current.next());
	}

	if (choice === freshChoice) {
		// No command context means no newSession() (see index.ts's
		// createCommandContext note) - prefill /plan, which runs with one and
		// reopens this picker ready for the handoff
		if (!freshContext) {
			ctx.ui.setEditorText("/plan");
			ctx.ui.notify(
				"Fresh sessions can only be started from a command - /plan is in the editor, press Enter and pick fresh execution again.",
				"info",
			);
			return;
		}
		pi.appendEntry("plan-mode", current.toState());
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession)
		await startFreshImplementation(freshContext, { plan: menuPlan });
	} else if (choice === currentChoice) {
		setMode(pi, ctx, slot, new DefaultMode());

		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (formatImplementationHandoff)
		const execMessage = `Plan mode is now disabled. Full tool access is restored. Implement this plan now:\n\n${menuPlan}`;
		pi.sendMessage(
			{ customType: "plan-mode-execute", content: execMessage, display: true },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	} else if (choice === refineChoice) {
		const refinement = await ctx.ui.editor("Refine the plan:", "");
		if (refinement?.trim()) {
			pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
		}
	}
}

// Present the approval menu from an event context: resolve the fresh-session
// handoff context from the latest command context, and tolerate the stale
// contexts a menu can outlive.
export async function presentApproval(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	latestCommandContext: ExtensionCommandContext | undefined,
	slot: ModeSlot,
): Promise<void> {
	// Fresh-session handoff needs a command context - agent_settled's ctx has no newSession.
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (latestCommandContext)
	const freshContext =
		latestCommandContext !== undefined && isCommandContext(latestCommandContext) ? latestCommandContext : undefined;
	try {
		await promptPlanApproval(pi, ctx, freshContext, slot);
	} catch (error: unknown) {
		if (!isStaleExtensionContextError(error)) throw error;
	}
}
