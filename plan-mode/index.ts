/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Plan-only tools (questionnaire, plan_complete) active only while planning
 * - Plan submitted via plan_complete as free-flow markdown (format-validated;
 *   heading titles become the phase checklist)
 * - Plan stored in session memory (appendEntry) - no files, no drift
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import { appendFileSync } from "node:fs";
import { CustomEditor, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { setIdleBorderColor, setPlanBorderColor, tintPlanBorders } from "./border-tint.ts";
import { getNormalModeTools, getPlanModeTools, unsafeCommandReason } from "./utils.ts";
import questionnaire from "./questionnaire.ts";
import { restorePlanModeState, type PlanModeState } from "./state.ts";
import { isCommandContext, isStaleExtensionContextError, startFreshImplementation } from "./fresh-implementation.ts";
import {
	normalizePlanCompletion,
	phaseTitles,
	planCompleted,
	planCompletionMarkdown,
	PLAN_COMPLETE_PARAMS,
	PLAN_COMPLETE_TOOL_NAME,
	type PlanCompletionRenderResult,
} from "./completion-tool.ts";

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

// Zen marks its editor factory with a registered symbol for cross-extension ownership checks
const ZENTUI_EDITOR_OWNER = Symbol.for("pi-zentui.editor-owner");

export default function planModeExtension(pi: ExtensionAPI): void {
	// Registers the questionnaire tool; visibility is toggled by the
	// required-helpers block in utils.ts (plan-mode only)
	questionnaire(pi);

	let planModeEnabled = false;
	let plan: string | undefined;
	// Staged by plan_complete, consumed by the agent_settled menu: a later settle
	// (queued follow-up delivered, refine turn) must not re-stack the picker
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (readyPresentationIntent)
	let awaitingApproval = false;
	let toolsBeforePlanMode: string[] | undefined;
	let latestCommandContext: ExtensionCommandContext | undefined;
	let installedEditorFactory: EditorFactory | undefined;
	// Read at wrap time: once our unmarked factory owns the slot, zen's mark on it is hidden
	let zenEditorDetected = false;
	let sessionGeneration = 0;
	// A fresh session receives its setup entries after session_start, so its
	// state is refreshed again before the first agent start
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (refreshStateBeforeFirstAgentStart)
	let refreshStateBeforeFirstAgentStart = false;

	function isZentuiFactory(factory: EditorFactory | undefined): boolean {
		return (factory as Record<PropertyKey, unknown> | undefined)?.[ZENTUI_EDITOR_OWNER] !== undefined;
	}

	function updateStatus(ctx: ExtensionContext): void {
		// Live theme getter: the role resolves at render time, so theme switches apply
		setPlanBorderColor((text) => ctx.ui.theme.fg("mdHeading", text));
		// Wrap (not replace) whatever editor is installed - theme UIs like zentui
		// render model/thinking in the border and keep working through the
		// forwarded borderColor; stock pi falls back to a tinted CustomEditor
		if (ctx.hasUI && ctx.ui.getEditorComponent() !== installedEditorFactory) {
			const base = ctx.ui.getEditorComponent();
			zenEditorDetected = isZentuiFactory(base);
			const factory: EditorFactory = (tui, theme, keybindings) =>
				tintPlanBorders(
					base ? base(tui, theme, keybindings) : new CustomEditor(tui, theme, keybindings),
					() => planModeEnabled,
				);
			installedEditorFactory = factory;
			ctx.ui.setEditorComponent(factory);
		}
		// Zen's static border resolves the borderMuted role (zen style.ts
		// EDITOR_BORDER_FALLBACK), so under adaptive mode the idle border emulates
		// that instead of pi's thinking-level colors - idle stays zen-gray, planning
		// turns the same lines orange heavy-weight, all live
		setIdleBorderColor(zenEditorDetected ? (text) => ctx.ui.theme.fg("borderMuted", text) : undefined);
		if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("mdHeading", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}
	}

	// Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts
	// (enablePlanModeTools/restoreNormalModeTools)
	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		// pi auto-activates newly registered tools, so plan-only helpers can pollute
		// both the pre-plan snapshot and the live set; derive rather than restore.
		pi.setActiveTools(getNormalModeTools(toolsBeforePlanMode ?? pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			// plan markdown while planning; activePlan once handed off for execution
			plan: planModeEnabled ? plan : undefined,
			activePlan: planModeEnabled ? undefined : plan,
			toolsBeforePlanMode,
		} satisfies PlanModeState);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		plan = undefined;
		awaitingApproval = false;

		if (planModeEnabled) {
			enablePlanModeTools();
			ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
		} else {
			restoreNormalModeTools();
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
		persistState();
	}

	// pi grants newSession() (and fork/switch/reload) only to command-handler
	// contexts - it creates them solely when executing an extension command and
	// inside withSession (runner.js createCommandContext has no other callers).
	// Events, tools, and shortcuts can therefore never start a session, which is
	// why /plan is the only plan-mode entry point and the fresh handoff below
	// bounces through it when the captured context is missing.
	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => {
			latestCommandContext = ctx;
			// With a completed plan, bare /plan reopens the approval menu instead of
			// toggling the plan away (the picker's exit choice discards)
			// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (/plan showCurrent)
			if (planModeEnabled && plan && ctx.hasUI) {
				debugLog("/plan reopen");
				await promptPlanApproval(ctx, ctx);
				return;
			}
			togglePlanMode(ctx);
		},
	});

	pi.registerCommand("todos", {
		description: "Show the current plan phases",
		handler: async (_args, ctx) => {
			if (!plan) {
				ctx.ui.notify("No plan phases. Create a plan first with /plan", "info");
				return;
			}
			const list = phaseTitles(plan).map((title, i) => `${i + 1}. ${title}`).join("\n");
			ctx.ui.notify(`Plan Phases:\n${list}`, "info");
		},
	});

	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts (renderPlanModeCompletion)
	const renderPlanCompletion = (result: PlanCompletionRenderResult) =>
		new Markdown(planCompletionMarkdown(result), 0, 0, getMarkdownTheme());

	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (registerTool: plan_mode_complete)
	pi.registerTool({
		name: PLAN_COMPLETE_TOOL_NAME,
		label: "Complete plan",
		description:
			"Use this tool when you have completed the planning phase and are ready to submit the plan. Call this tool: after you have written a complete plan, after you have clarified any questions with the user, when you are confident the plan is ready for implementation. Do NOT call this tool: before you have finalized the plan, if you still have unanswered questions about the implementation, if the user has indicated that they want to continue planning.",
		parameters: PLAN_COMPLETE_PARAMS,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!planModeEnabled) {
				throw new Error("plan_complete is only available while plan mode is active");
			}
			const parsed = normalizePlanCompletion(params);
			if (!parsed.ok) throw new Error(parsed.error);

			plan = parsed.plan;
			awaitingApproval = true;
			debugLog("plan_complete", { phases: phaseTitles(parsed.plan).length });
			return planCompleted(parsed.plan);
		},
		renderResult: renderPlanCompletion,
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		const unsafeReason = unsafeCommandReason(command);
		if (unsafeReason) {
			return {
				block: true,
				reason: `Plan mode: command blocked (${unsafeReason}). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async (_event, ctx) => {
		refreshStateForFirstPrompt(ctx);
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					// Initial understanding, plan format, read-only override, and
					// question-or-submit ending adapted from opencode's plan-mode prompt
					// (Phases 1, 4-5), its plan.txt (tradeoffs questioning, read-only
					// override), and its tool/plan-exit.txt (tool gating). Explore subagents
					// adapted to read-only pi child processes spawned via bash (the one
					// allowlisted pi command):
					// https://github.com/sst/opencode/blob/main/packages/opencode/src/session/prompt/plan-mode.txt
					content: `[PLAN MODE ACTIVE]
The user indicated that they do not want you to execute yet -- you MUST NOT
make any edits, run any non-readonly tools (including changing configs or
making commits), or otherwise make any changes to the system. This supersedes
any other instructions you have received.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

1. Focus on understanding the user's request and the code associated with their request
2. For uncertain scope, launch up to 3 read-only explore children in parallel,
   one bash call each in a single message, exactly this command with your
   focus quoted:
   pi --print --no-extensions --no-session --tools read,grep,find,ls "<focus> - report findings"
   Quality over quantity - use the fewest children that cover the scope
3. Use the questionnaire tool to clarify ambiguities in the user request up
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

At the very end of your turn, once you have asked the user questions and are
happy with your final plan, call the plan_complete tool alone, passing the
whole plan markdown as its plan argument. This is critical - your turn should
only end with either asking the user a question or calling plan_complete. Do
not stop unless it's for these 2 reasons. Do NOT use the questionnaire tool
to ask "Is this plan okay?" - that's what plan_complete does.`,
					display: false,
				},
			};
		}
	});

	// Approval picker for a completed plan. Offered with or without a
	// fresh-session context - like narumiruna's ready menu, only the fresh
	// handoff is gated, never the choice itself.
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled latestCommandContext ?? ctx)
	async function promptPlanApproval(ctx: ExtensionContext, freshContext: ExtensionCommandContext | undefined): Promise<void> {
		if (!plan) return;

		// Checklist titles are derived from the plan's markdown headings
		const phases = phaseTitles(plan);
		const todoListText = phases.map((title, i) => `${i + 1}. ☐ ${title}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Phases (${phases.length}):**\n\n${todoListText}`,
			display: true,
		};

		// Bail when the session was replaced or the plan was superseded while the
		// menu was open
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (completedPlanIsCurrent)
		const menuGeneration = sessionGeneration;
		const menuPlan = plan;

		// Choice labels are bound to constants and compared with === against the
		// same constants, so the "(recommended)" suffix cannot drift from the check.
		// Source: https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (handlePlanApproval)
		const freshChoice = "Execute in fresh session (recommended)";
		const currentChoice = "Execute in current session";
		const stayChoice = "Stay in plan mode";
		const refineChoice = "Refine the plan";
		const exitChoice = "Exit plan mode (discard plan)";
		const choice = await ctx.ui.select("Plan mode - what next?", [freshChoice, currentChoice, stayChoice, refineChoice, exitChoice]);
		if (sessionGeneration !== menuGeneration || plan !== menuPlan) return;
		if (!choice || choice === stayChoice) return;

		if (choice === exitChoice) {
			togglePlanMode(ctx);
		}

		if (choice === freshChoice) {
			// No command context means no newSession() (see the createCommandContext
			// note above) - prefill /plan, which runs with one and reopens this
			// picker ready for the handoff
			if (!freshContext) {
				debugLog("fresh bounce", { hasCommandContext: false });
				ctx.ui.setEditorText("/plan");
				ctx.ui.notify(
					"Fresh sessions can only be started from a command - /plan is in the editor, press Enter and pick fresh execution again.",
					"info",
				);
				return;
			}
			const savedPlan = plan;
			persistState();
			// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession)
			await startFreshImplementation(freshContext, { plan: savedPlan });
		} else if (choice === currentChoice) {
			if (!plan) return;

			planModeEnabled = false;
			restoreNormalModeTools();
			updateStatus(ctx);
			persistState();

			// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (formatImplementationHandoff)
			const execMessage = `Plan mode is now disabled. Full tool access is restored. Implement this plan now:\n\n${plan}`;
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (choice === refineChoice) {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	}

	// Persist state after every planning turn (the plan itself arrives via the
	// plan_complete tool call, not prose extraction)
	pi.on("agent_end", async () => {
		if (!planModeEnabled) return;
		persistState();
	});

	// Present the approval menu once the agent truly settles - not between a
	// turn end and delivery of still-queued follow-up messages, which would
	// stack a second menu behind the first
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled)
	pi.on("agent_settled", async (_event, ctx) => {
		if (!planModeEnabled || !ctx.hasUI) return;
		if (!plan || !awaitingApproval) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
		awaitingApproval = false;
		debugLog("agent_settled menu", { idle: true, pending: ctx.hasPendingMessages() });

		// Fresh-session handoff needs a command context - agent_settled's ctx has no newSession.
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (latestCommandContext)
		const freshContext =
			latestCommandContext !== undefined && isCommandContext(latestCommandContext) ? latestCommandContext : undefined;
		debugLog("approval menu", { hasCommandContext: freshContext !== undefined });
		try {
			await promptPlanApproval(ctx, freshContext);
		} catch (error: unknown) {
			if (!isStaleExtensionContextError(error)) throw error;
		}
	});

	// Runs before dispose() invalidates this instance's contexts: retire the
	// deferred status refreshes and editor re-checks so nothing fires on a
	// stale ctx afterwards
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (session_shutdown)
	pi.on("session_shutdown", async () => {
		debugLog("session_shutdown");
		latestCommandContext = undefined;
		sessionGeneration += 1;
		refreshStateBeforeFirstAgentStart = false;
	});

	// Restore state on session start/resume from session memory (appendEntry).
	// Runs on session replacement too (newSession/fork/switch): saved state is
	// authoritative so the replaced session's mode/plan cannot leak.
	pi.on("session_start", async (event, ctx) => {
		debugLog("session_start", { reason: event.reason });
		latestCommandContext = undefined;
		sessionGeneration += 1;
		awaitingApproval = false;
		// A fresh session receives its setup entries (the handed-off plan) only
		// after session_start, so the restore below misses them
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (refreshStateBeforeFirstAgentStart)
		refreshStateBeforeFirstAgentStart = event.reason === "new";

		// Restore persisted state, recovering the plan from the latest
		// plan_complete toolResult when no state entry was persisted after it
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts (restorePlanModeState)
		const saved = restorePlanModeState(ctx.sessionManager.getEntries());
		planModeEnabled = saved.enabled;
		plan = saved.plan ?? saved.activePlan;
		toolsBeforePlanMode = saved.toolsBeforePlanMode;

		if (planModeEnabled) {
			enablePlanModeTools();
		} else {
			// Also covers fresh sessions, where the helpers start out auto-active.
			// narumiruna hides the helpers at session start until the first plan activation.
			// Source: https://github.com/narumiruna/pi-extensions/blob/e74ee843d8ad1a6ef1932922a7d8dad335b24baa/packages/pi-plan-mode/src/helper-tool-visibility.ts (reconcileInactiveState/hideIfLocked)
			restoreNormalModeTools();
		}
		updateStatus(ctx);
		// Zen installs its editor later in the same startup cascade (its session_start
		// runs after ours), so the first check above sees an unmarked slot; re-check
		// shortly after so even the first idle frame gets the emulated border
		if (ctx.hasUI) {
			const generation = sessionGeneration;
			for (const delay of [0, 100, 500, 2000]) {
				setTimeout(() => {
					if (generation === sessionGeneration) updateStatus(ctx);
				}, delay);
			}
		}
	});

	// Picks up the handed-off plan that setup appended after the fresh session's
	// session_start had already restored state
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (refreshStateForFirstPrompt)
	function refreshStateForFirstPrompt(ctx: ExtensionContext): void {
		if (!refreshStateBeforeFirstAgentStart) return;
		refreshStateBeforeFirstAgentStart = false;
		const saved = restorePlanModeState(ctx.sessionManager.getEntries());
		plan = saved.plan ?? saved.activePlan;
		toolsBeforePlanMode = saved.toolsBeforePlanMode;
		debugLog("refreshStateForFirstPrompt", { restoredPlan: plan !== undefined });
	}

	// Env-gated trace for menu/handoff diagnosis: PLAN_MODE_DEBUG=<file> pi ...
	function debugLog(event: string, data?: unknown): void {
		const path = process.env.PLAN_MODE_DEBUG;
		if (!path) return;
		try {
			appendFileSync(path, `${new Date().toISOString()} ${event}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`);
		} catch {
			// diagnostics must never break the session
		}
	}
}
