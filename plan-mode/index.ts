/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Plan submitted via a structured plan_complete tool call (no prose parsing)
 * - Plan stored in session memory (appendEntry) - no files, no drift
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { isSafeCommand } from "./utils.ts";
import { restorePlanModeState, type PlanModeState } from "./state.ts";
import {
	normalizePlanCompletion,
	planCompleted,
	PLAN_COMPLETE_PARAMS,
	PLAN_COMPLETE_TOOL_NAME,
} from "./completion-tool.ts";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", PLAN_COMPLETE_TOOL_NAME];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let planSteps: string[] | undefined;
	let toolsBeforePlanMode: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}
	}

	function uniqueToolNames(toolNames: string[]): string[] {
		return [...new Set(toolNames)];
	}

	function getPlanModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]);
	}

	function getNormalModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...NORMAL_MODE_TOOLS,
			...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
		]);
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			planSteps,
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
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show the current plan steps",
		handler: async (_args, ctx) => {
			if (!planSteps || planSteps.length === 0) {
				ctx.ui.notify("No plan steps. Create a plan first with /plan", "info");
				return;
			}
			const list = planSteps.map((text, i) => `${i + 1}. ${text}`).join("\n");
			ctx.ui.notify(`Plan Steps:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
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
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
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

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (_event, ctx) => {
		if (!planModeEnabled || !ctx.hasUI) return;

		// Steps arrive via the plan_complete tool call, not prose extraction
		if (!planSteps || planSteps.length === 0) return;
		persistState();

		// Show plan steps and prompt for next action
		const todoListText = planSteps.map((text, i) => `${i + 1}. ☐ ${text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${planSteps.length}):**\n\n${todoListText}`,
			display: true,
		};

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
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
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	// Restore state on session start/resume from session memory (appendEntry)
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		// Restore persisted state, recovering the plan from the latest
		// plan_complete toolResult when no state entry was persisted after it
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts (restorePlanModeState)
		const saved = restorePlanModeState(ctx.sessionManager.getEntries());
		planModeEnabled = saved.enabled || planModeEnabled;
		planSteps = saved.planSteps ?? planSteps;
		toolsBeforePlanMode = saved.toolsBeforePlanMode ?? toolsBeforePlanMode;

		if (planModeEnabled) {
			enablePlanModeTools();
		}
		updateStatus(ctx);
	});
}