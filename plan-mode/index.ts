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
 *
 * The mode objects (mode.ts) own the tool set, UI, and event behavior;
 * state.ts swaps them, resolves the approval menu, and persists them. This
 * module is the wiring: commands, events, and session lifecycle.
 */

import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DefaultMode, isDefaultMode, isPlanningMode, registerCompletionTool } from "./mode.ts";
import questionnaire from "./questionnaire.ts";
import { type ModeSlot, presentApproval, promptPlanApproval, restoreMode, setMode } from "./state.ts";

export default function planModeExtension(pi: ExtensionAPI): void {
	// The live mode plus the session-replacement counter the menu guards read
	const modeSlot: ModeSlot = { mode: new DefaultMode(), rev: 0 };

	// Registers the questionnaire tool; visibility is toggled by the
	// required-helpers block in utils.ts (plan-mode only)
	questionnaire(pi);
	registerCompletionTool(pi, () => modeSlot.mode);

	let latestCommandContext: ExtensionCommandContext | undefined;
	// A fresh session receives its setup entries after session_start, so its
	// state is refreshed again before the first agent start
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (refreshStateBeforeFirstAgentStart)
	let refreshStateBeforeFirstAgentStart = false;

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
			// toggling the plan away (the picker's exit choice is the way out)
			// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (/plan showCurrent)
			if (isPlanningMode(modeSlot.mode) && modeSlot.mode.plan && ctx.hasUI) {
				debugLog("/plan reopen");
				await promptPlanApproval(pi, ctx, ctx, modeSlot);
				return;
			}
			setMode(pi, ctx, modeSlot, modeSlot.mode.next());
		},
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		return modeSlot.mode.bashBlockReason(event.input.command as string);
	});

	pi.on("context", async (event) => ({ messages: modeSlot.mode.filterContext(event.messages) }));

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async (_event, ctx) => {
		refreshStateForFirstPrompt(ctx);
		const message = modeSlot.mode.agentStartMessage();
		return message ? { message } : undefined;
	});

	pi.on("agent_end", async () => modeSlot.mode.onAgentEnd(pi));

	// Present the approval menu once the agent truly settles - not between a
	// turn end and delivery of still-queued follow-up messages, which would
	// stack a second menu behind the first
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled)
	pi.on("agent_settled", async (_event, ctx) => {
		if (!ctx.hasUI || !modeSlot.mode.shouldPromptApproval()) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
		debugLog("agent_settled menu", { idle: true, pending: ctx.hasPendingMessages() });
		await presentApproval(pi, ctx, latestCommandContext, modeSlot);
	});

	// Runs before dispose() invalidates this instance's contexts: retire the
	// deferred status refreshes and editor re-checks so nothing fires on a
	// stale ctx afterwards
	// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (session_shutdown)
	pi.on("session_shutdown", async () => {
		debugLog("session_shutdown");
		latestCommandContext = undefined;
		modeSlot.rev += 1;
		refreshStateBeforeFirstAgentStart = false;
	});

	// Restore state on session start/resume from session memory (appendEntry).
	// Runs on session replacement too (newSession/fork/switch): saved state is
	// authoritative so the replaced session's mode/plan cannot leak.
	pi.on("session_start", async (event, ctx) => {
		debugLog("session_start", { reason: event.reason });
		latestCommandContext = undefined;
		modeSlot.rev += 1;
		// A fresh session receives its setup entries (the handed-off plan) only
		// after session_start, so the restore below misses them
		// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (refreshStateBeforeFirstAgentStart)
		refreshStateBeforeFirstAgentStart = event.reason === "new";
		modeSlot.mode = restoreMode(ctx.sessionManager.getEntries());
		modeSlot.mode.enter(pi, ctx, { notify: false });

		// Zen installs its editor later in the same startup cascade (its session_start
		// runs after ours), so the first check above sees an unmarked slot; re-check
		// shortly after so even the first idle frame gets the emulated border
		if (ctx.hasUI) {
			const rev = modeSlot.rev;
			for (const delay of [0, 100, 500, 2000]) {
				setTimeout(() => {
					if (rev === modeSlot.rev) modeSlot.mode.enter(pi, ctx, { notify: false });
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
		modeSlot.mode = restoreMode(ctx.sessionManager.getEntries());
		const restoredPlan =
			isPlanningMode(modeSlot.mode) ? modeSlot.mode.plan : isDefaultMode(modeSlot.mode) ? modeSlot.mode.activePlan : undefined;
		debugLog("refreshStateForFirstPrompt", { restoredPlan: restoredPlan !== undefined });
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
