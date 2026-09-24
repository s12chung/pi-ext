/**
 * Fresh-session execution: start a brand-new session whose kickoff prompt
 * embeds the approved plan - the planning transcript stays behind in the
 * parent session.
 */

import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanModeState } from "./state.ts";

// Source (adapted: model preflight, retention, and runtime selection dropped):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts
export function isCommandContext(ctx: ExtensionContext): ctx is ExtensionCommandContext {
	return typeof (ctx as Partial<ExtensionCommandContext>).newSession === "function";
}

// Kickoff text: narumiruna's formatTransferredPlanPrompt body with bacnh85's
// fresh-session prefix
// https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (buildExecutionPrompt)
export function formatTransferredPlanPrompt(plan: string): string {
	return `This is a fresh session created from an approved plan. A previous agent produced the markdown plan below to accomplish the user's task. Implement the plan in this fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.\n\n${plan}`;
}

export interface FreshImplementationOptions {
	plan: string;
	/**
	 * Seed the extension's in-memory state for the fresh session. session_start
	 * fires before setup() on newSession, so the restore path cannot see the
	 * appended entry yet - this callback runs inside withSession instead.
	 */
	activate: (ctx: ExtensionCommandContext) => void;
}

export async function startFreshImplementation(
	ctx: ExtensionCommandContext,
	options: FreshImplementationOptions,
): Promise<void> {
	await ctx.waitForIdle();
	const handoff = formatTransferredPlanPrompt(options.plan);
	const parentSession = ctx.sessionManager.getSessionFile();
	let result: Awaited<ReturnType<ExtensionCommandContext["newSession"]>>;
	try {
		result = await ctx.newSession({
			...(parentSession ? { parentSession } : {}),
			setup: async (sessionManager) => {
				// Persists the plan for future resumes of the fresh session file.
				// The plan rides the disabled-state field, like activeImplementation in
				// narumiruna's destinationState, so restorePlanModeState reads it.
				// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession destinationState)
				sessionManager.appendCustomEntry("plan-mode", {
					enabled: false,
					activePlan: options.plan,
				} satisfies PlanModeState);
			},
			withSession: async (replacementCtx) => {
				options.activate(replacementCtx);
				await replacementCtx.sendUserMessage(handoff);
			},
		});
	} catch (error) {
		safeNotify(ctx, `Fresh-session execution failed: ${error instanceof Error ? error.message : error}. The plan remains available.`, "error");
		return;
	}
	if (result.cancelled) safeNotify(ctx, "Fresh-session execution cancelled. The plan remains available.", "info");
}

// A source context can go stale while the session is being replaced
function safeNotify(ctx: Pick<ExtensionContext, "ui">, message: string, level: "info" | "warning" | "error"): void {
	try {
		ctx.ui.notify(message, level);
	} catch {
		// context already replaced
	}
}
