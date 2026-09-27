/**
 * The modes as objects: index.ts stores the current one and swaps it on
 * toggle; each mode owns its tool set, UI, and event behavior.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentToolResult, BeforeAgentStartEventResult, ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { ensureBorderTint, setPlanBorderActive } from "./border-tint.ts";
import { ExplorePhase, isApprovePhase, normalizePlanCompletion, planCompleted, type PlanCompletionDetails, type PlanCompletionParams, type PlanningPhaseState } from "./completion-tool.ts";
import type { PlanModeState } from "./state.ts";
import { getNormalModeTools, getPlanModeTools, unsafeCommandReason } from "./utils.ts";

// Registration lives with the phases it advances (completion-tool.ts);
// re-exported so index.ts wires modes without importing completion internals
export { registerCompletionTool } from "./completion-tool.ts";

// The [PLAN MODE ACTIVE] prompt injected before every planning agent start.
// Initial understanding, plan format, read-only override, and
// question-or-submit ending adapted from opencode's plan-mode prompt
// (Phases 1, 4-5), its plan.txt (tradeoffs questioning, read-only
// override), and its tool/plan-exit.txt (tool gating):
// https://github.com/sst/opencode/blob/main/packages/opencode/src/session/prompt/plan-mode.txt
const PLAN_MODE_PROMPT = `[PLAN MODE ACTIVE]
The user indicated that they do not want you to execute yet -- you MUST NOT
make any edits, run any non-readonly tools (including changing configs or
making commits), or otherwise make any changes to the system. This supersedes
any other instructions you have received.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

1. Focus on understanding the user's request and the code associated with their request
2. Use the questionnaire tool to clarify ambiguities in the user request up
   front, and ask for their opinion when weighing tradeoffs - don't make
   large assumptions about user intent

Plan format - free-flow markdown, concise enough to scan quickly, but
detailed enough to execute effectively:
- Include only your recommended approach, not all alternatives
- Break the work into a few phases, each opened by a numbered markdown
  heading ("## 1. Short title", numbered sequentially from 1) followed by
  its description
- Include the paths of critical files to be modified
- End with a verification phase describing how to test the changes
  end-to-end (run the code, run tests)

At the very end of your turn, once you have asked the user questions and
are happy with your final plan, call the plan_complete tool alone, passing the
whole plan markdown as its plan argument. This is critical - your turn should
only end with either asking the user a question or calling plan_complete. Do
not stop unless it's for these 2 reasons. Do NOT use the questionnaire tool
to ask "Is this plan okay?" - that's what plan_complete does.`;

export type EnterOptions = { notify?: boolean };

export abstract class Mode {
	/** Apply the tool set and UI. Idempotent - the session_start restore path re-calls it. */
	abstract enter(pi: ExtensionAPI, ctx: ExtensionContext, options?: EnterOptions): void;
	/** /plan toggle successor, carrying handoff data */
	abstract next(): Mode;
	/** Persisted shape; state.ts reconstructs the objects from it */
	abstract toState(): PlanModeState;

	agentStartMessage(): BeforeAgentStartEventResult["message"] { return undefined; }
	bashBlockReason(_command: string): ToolCallEventResult | undefined { return undefined; }
	filterContext(messages: AgentMessage[]): AgentMessage[] { return messages; }
	onAgentEnd(_pi: ExtensionAPI): void {}
	shouldPromptApproval(): boolean { return false; }

	// Registration is split from the logic (see registerCompletionTool):
	// execute delegates here, and the base refuses outside plan mode
	async completePlan(_params: PlanCompletionParams): Promise<AgentToolResult<PlanCompletionDetails>> {
		throw new Error("plan_complete is only available while plan mode is active");
	}
}

export class DefaultMode extends Mode {
	// Plan handed off for execution in this session, if any
	readonly activePlan: string | undefined;
	readonly toolsBeforePlanMode: string[] | undefined;

	constructor(activePlan?: string, toolsBeforePlanMode?: string[]) {
		super();
		this.activePlan = activePlan;
		this.toolsBeforePlanMode = toolsBeforePlanMode;
	}

	enter(pi: ExtensionAPI, ctx: ExtensionContext, options?: EnterOptions): void {
		ensureBorderTint(ctx);
		setPlanBorderActive(false);
		// pi auto-activates newly registered tools, so plan-only helpers can pollute
		// both the pre-plan snapshot and the live set; derive rather than restore.
		// Also covers fresh sessions, where the helpers start out auto-active.
		// narumiruna hides the helpers at session start until the first plan activation.
		// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts
		// (enablePlanModeTools/restoreNormalModeTools)
		// Source: https://github.com/narumiruna/pi-extensions/blob/e74ee843d8ad1a6ef1932922a7d8dad335b24baa/packages/pi-plan-mode/src/helper-tool-visibility.ts (reconcileInactiveState/hideIfLocked)
		pi.setActiveTools(getNormalModeTools(this.toolsBeforePlanMode ?? pi.getActiveTools()));
		ctx.ui.setStatus("plan-mode", undefined);
		if (options?.notify !== false) ctx.ui.notify("Plan mode disabled. Full access restored.");
	}

	next(): Mode {
		return new PlanningMode();
	}

	toState(): PlanModeState {
		return { mode: "default", activePlan: this.activePlan, toolsBeforePlanMode: this.toolsBeforePlanMode };
	}

	// Filter out stale plan mode context when not in plan mode
	filterContext(messages: AgentMessage[]): AgentMessage[] {
		// Request-time projection over a structuredClone (pi's emitContext): session
		// entries are never edited, so re-entering planning re-includes these.
		//
		// Prefix-cache note: dropping mid-history messages invalidates the provider's
		// cached prefix from the first removal onward - but the mode toggle already
		// swapped the active tool set, which is part of the cached prefix, forcing
		// that miss regardless; and the filter is deterministic, so the first DEFAULT
		// request re-caches the filtered prefix and later turns extend it again.
		return messages.filter((m) => {
			if (m.role === "custom" && m.customType === "plan-mode-context") return false;
			if (m.role !== "user") return true;

			const content = m.content;
			if (typeof content === "string") {
				return !content.includes("[PLAN MODE ACTIVE]");
			}
			if (Array.isArray(content)) {
				return !content.some((c) => c.type === "text" && c.text.includes("[PLAN MODE ACTIVE]"));
			}
			return true;
		});
	}
}

export class PlanningMode extends Mode {
	// PLANNING_PHASE state, stored here: explore until plan_complete, approval
	// after - the phases themselves are completion-tool.ts's interface
	phase: PlanningPhaseState = new ExplorePhase();
	toolsBeforePlanMode: string[] | undefined;

	get plan(): string | undefined {
		return isApprovePhase(this.phase) ? this.phase.plan : undefined;
	}

	enter(pi: ExtensionAPI, ctx: ExtensionContext, options?: EnterOptions): void {
		ensureBorderTint(ctx);
		setPlanBorderActive(true);
		// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts
		// (enablePlanModeTools/restoreNormalModeTools)
		if (this.toolsBeforePlanMode === undefined) {
			this.toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(this.toolsBeforePlanMode));
		ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("mdHeading", "⏸ plan"));
		if (options?.notify !== false) ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
	}

	next(): Mode {
		return new DefaultMode(undefined, this.toolsBeforePlanMode);
	}

	toState(): PlanModeState {
		return {
			mode: "planning",
			phase: this.phase.id,
			plan: this.plan,
			toolsBeforePlanMode: this.toolsBeforePlanMode,
		};
	}

	// Validate, advance the phase, build the tool result
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (registerTool: plan_mode_complete)
	async completePlan(params: PlanCompletionParams): Promise<AgentToolResult<PlanCompletionDetails>> {
		const parsed = normalizePlanCompletion(params.plan);
		if (!parsed.ok) throw new Error(parsed.error);
		this.phase = this.phase.submitPlan(parsed.plan);
		return planCompleted(parsed.plan);
	}

	agentStartMessage(): BeforeAgentStartEventResult["message"] {
		return { customType: "plan-mode-context", content: PLAN_MODE_PROMPT, display: false };
	}

	// Block destructive bash commands in plan mode
	bashBlockReason(command: string): ToolCallEventResult | undefined {
		const unsafeReason = unsafeCommandReason(command);
		if (unsafeReason === undefined) return undefined;
		return {
			block: true,
			reason: `Plan mode: command blocked (${unsafeReason}). Use /plan to disable plan mode first.\nCommand: ${command}`,
		};
	}

	// Persist state after every planning turn (the plan itself arrives via the
	// plan_complete tool call, not prose extraction)
	onAgentEnd(pi: ExtensionAPI): void {
		pi.appendEntry("plan-mode", this.toState());
	}

	// The agent_settled menu is owed while a plan is staged
	shouldPromptApproval(): boolean {
		return isApprovePhase(this.phase);
	}

	// The approval menu opened: back to exploring, plan in hand only inside the
	// menu - a refined plan re-enters approval via plan_complete
	rejectApproval(): void {
		this.phase = new ExplorePhase();
	}
}

// Type guards so callers narrow without reaching for the classes
export function isPlanningMode(mode: Mode): mode is PlanningMode {
	return mode instanceof PlanningMode;
}

export function isDefaultMode(mode: Mode): mode is DefaultMode {
	return mode instanceof DefaultMode;
}

