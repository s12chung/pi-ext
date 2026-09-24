/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command or alt+p to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Plan-only tools (questionnaire, plan_complete) active only while planning
 * - Plan submitted via a structured plan_complete tool call (no prose parsing)
 * - Plan stored in session memory (appendEntry) - no files, no drift
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { getNormalModeTools, getPlanModeTools, unsafeCommandReason } from "./utils.ts";
import { restorePlanModeState, type PlanModeState } from "./state.ts";
import { isCommandContext, startFreshImplementation } from "./fresh-implementation.ts";
import {
	normalizePlanCompletion,
	planCompleted,
	PLAN_COMPLETE_PARAMS,
	PLAN_COMPLETE_TOOL_NAME,
} from "./completion-tool.ts";

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let planSteps: string[] | undefined;
	let toolsBeforePlanMode: string[] | undefined;
	// Goes stale on session replacement; cleared in session_start, re-captured by the command handlers
	let latestCommandContext: ExtensionCommandContext | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	// #FFCF82 has no theme role, so the chip carries its own truecolor escape (dark-theme tuned)
	const planModeChip = (text: string) => `\x1b[38;2;255;207;130m${text}\x1b[39m`;

	function updateStatus(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", planModeChip("⏸ plan"));
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
			// latestPlan while planning; activeSteps once handed off for execution
			planSteps: planModeEnabled ? planSteps : undefined,
			activeSteps: planModeEnabled ? undefined : planSteps,
			toolsBeforePlanMode,
		} satisfies PlanModeState);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		planSteps = undefined;

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

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => {
			latestCommandContext = ctx;
			togglePlanMode(ctx);
		},
	});

	pi.registerCommand("todos", {
		description: "Show the current plan steps",
		handler: async (_args, ctx) => {
			latestCommandContext = ctx;
			if (!planSteps || planSteps.length === 0) {
				ctx.ui.notify("No plan steps. Create a plan first with /plan", "info");
				return;
			}
			const list = planSteps.map((text, i) => `${i + 1}. ${text}`).join("\n");
			ctx.ui.notify(`Plan Steps:\n${list}`, "info");
			if (!planModeEnabled || !ctx.hasUI) return;
			// The command handler's ctx has newSession(), so the fresh-session
			// choice works here even when plan mode was entered via alt+p or --plan.
			await promptPlanApproval(ctx, ctx);
		},
	});

	pi.registerShortcut(Key.alt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (registerTool: plan_mode_complete)
	pi.registerTool({
		name: PLAN_COMPLETE_TOOL_NAME,
		label: "Complete plan",
		description:
			"Submit the decision-ready plan while plan mode is active, and call it alone as the final action. Never call it for ordinary planning requests.",
		parameters: PLAN_COMPLETE_PARAMS,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!planModeEnabled) {
				throw new Error("plan_complete is only available while plan mode is active");
			}
			const parsed = normalizePlanCompletion(params);
			if (!parsed.ok) throw new Error(parsed.error);

			planSteps = parsed.steps;
			return planCompleted(parsed.steps);
		},
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
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					// Ending rule below copied/adapted from narumiruna's plan-mode prompt:
					// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/prompt.ts
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

When the plan is decision-ready, call the plan_complete tool alone as your
final action with the ordered implementation steps. Never end with prose that
merely announces the plan - submit it with the tool call.

Do NOT attempt to make changes - just describe what you would do.`,
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
		if (!planSteps || planSteps.length === 0) return;

		// Show plan steps and prompt for next action
		const todoListText = planSteps.map((text, i) => `${i + 1}. ☐ ${text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${planSteps.length}):**\n\n${todoListText}`,
			display: true,
		};

		// Choice labels are bound to constants and compared with === against the
		// same constants, so the "(recommended)" suffix cannot drift from the check.
		// Source: https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (handlePlanApproval)
		const freshChoice = "Execute in fresh session (recommended)";
		const currentChoice = "Execute in current session";
		const stayChoice = "Stay in plan mode";
		const refineChoice = "Refine the plan";
		const choice = await ctx.ui.select("Plan mode - what next?", [freshChoice, currentChoice, stayChoice, refineChoice]);
		if (!choice || choice === stayChoice) return;

		if (choice === freshChoice) {
			// No command context means no newSession() - bail to the interactive
			// command instead of hiding the choice.
			// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationFromState isCommandContext bail)
			if (!freshContext) {
				ctx.ui.notify(
					"Fresh implementation requires the interactive /todos command. Run /todos and try again.",
					"warning",
				);
				return;
			}
			const steps = planSteps;
			persistState();
			// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession)
			await startFreshImplementation(freshContext, {
				steps,
				activate: (ctx) => {
					planModeEnabled = false;
					planSteps = steps;
					if (toolsBeforePlanMode !== undefined) {
						restoreNormalModeTools();
					}
					updateStatus(ctx);
				},
			});
		} else if (choice === currentChoice) {
			if (!planSteps || planSteps.length === 0) return;

			planModeEnabled = false;
			restoreNormalModeTools();
			updateStatus(ctx);
			persistState();

			// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (formatImplementationHandoff)
			const stepList = planSteps.map((text, i) => `${i + 1}. ${text}`).join("\n");
			const execMessage = `Plan mode is now disabled. Full tool access is restored. Implement this plan now:\n\n${stepList}`;
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

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (_event, ctx) => {
		if (!planModeEnabled || !ctx.hasUI) return;

		// Steps arrive via the plan_complete tool call, not prose extraction
		if (!planSteps || planSteps.length === 0) return;
		persistState();

		// Fresh-session handoff needs a command context - agent_end's ctx has no newSession.
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (latestCommandContext)
		const freshContext =
			latestCommandContext !== undefined && isCommandContext(latestCommandContext) ? latestCommandContext : undefined;
		await promptPlanApproval(ctx, freshContext);
	});

	// Restore state on session start/resume from session memory (appendEntry).
	// Runs on session replacement too (newSession/fork/switch): saved state is
	// authoritative so the replaced session's mode/steps cannot leak.
	pi.on("session_start", async (event, ctx) => {
		latestCommandContext = undefined;

		// Restore persisted state, recovering the plan from the latest
		// plan_complete toolResult when no state entry was persisted after it
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts (restorePlanModeState)
		const saved = restorePlanModeState(ctx.sessionManager.getEntries());
		planModeEnabled = saved.enabled;
		// --plan applies only to the initial launch - never to mid-session
		// replacements (manual /new, fresh-session handoff)
		// Source: https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (session_start --plan gating)
		if (event.reason === "startup" && pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}
		planSteps = saved.planSteps ?? saved.activeSteps;
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
	});
}