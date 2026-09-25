/**
 * Fresh-session execution: start a brand-new session whose kickoff prompt
 * embeds the approved plan - the planning transcript stays behind in the
 * parent session.
 */

import { stripVTControlCharacters } from "node:util";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanModeState } from "./state.ts";

type NewSessionOptions = Exclude<Parameters<ExtensionCommandContext["newSession"]>[0], undefined>;
type ReplacementContext = Parameters<NonNullable<NewSessionOptions["withSession"]>>[0];

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

export type FreshImplementationResult =
	| { kind: "started" }
	| { kind: "cancelled" }
	| { kind: "partial" }
	| { kind: "rejected" };

export interface FreshImplementationOptions {
	plan: string;
}

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession)
export async function startFreshImplementation(
	ctx: ExtensionCommandContext,
	options: FreshImplementationOptions,
): Promise<FreshImplementationResult> {
	await ctx.waitForIdle();

	const handoff = formatTransferredPlanPrompt(options.plan);
	const parentSession = ctx.sessionManager.getSessionFile();
	let setupError: string | undefined;

	// The plan rides the disabled-state field, like activeImplementation in
	// narumiruna's destinationState, so restorePlanModeState reads it. The new
	// session's session_start fires before setup appends the entry, so its
	// state is refreshed again before the first agent start instead.
	let result: Awaited<ReturnType<ExtensionCommandContext["newSession"]>>;
	try {
		result = await ctx.newSession({
			...(parentSession ? { parentSession } : {}),
			setup: async (sessionManager) => {
				try {
					sessionManager.appendCustomEntry("plan-mode", {
						enabled: false,
						activePlan: options.plan,
					} satisfies PlanModeState);
				} catch (error: unknown) {
					setupError = safeErrorDetail(error);
				}
			},
			withSession: async (replacementCtx) => {
				if (setupError) {
					recoverSetupFailure(replacementCtx, handoff, setupError);
					return;
				}
				try {
					await replacementCtx.sendUserMessage(handoff);
				} catch (error: unknown) {
					reportKickoffFailure(replacementCtx, handoff, safeErrorDetail(error));
					return;
				}
				safeNotify(replacementCtx, "Fresh implementation session started. Only the approved plan was transferred.", "info");
			},
		});
	} catch (error: unknown) {
		safeNotify(
			ctx,
			`Unable to start a fresh implementation session: ${safeErrorDetail(error)}. The plan remains available; retry or resume the planning session.`,
			"error",
		);
		return { kind: "rejected" };
	}

	if (result.cancelled) {
		safeNotify(ctx, "Fresh implementation cancelled. The plan remains available.", "info");
		return { kind: "cancelled" };
	}
	return setupError ? { kind: "partial" } : { kind: "started" };
}

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (recoverSetupFailure/reportKickoffFailure, conversation-history variant)
function recoverSetupFailure(ctx: ReplacementContext, handoff: string, setupError: string): void {
	const recoveredInEditor = safeSetEditorText(ctx, handoff);
	safeNotify(
		ctx,
		recoveredInEditor
			? `Fresh session created, but the plan could not be saved: ${setupError}. The implementation request is in the editor; submit it to continue or resume the parent planning session.`
			: `Fresh session created, but the plan could not be saved: ${setupError}. The implementation request could not be restored to the editor; resume the parent planning session.`,
		"error",
	);
}

function reportKickoffFailure(ctx: ReplacementContext, handoff: string, detail: string): void {
	const recoveredInEditor = safeSetEditorText(ctx, handoff);
	safeNotify(
		ctx,
		recoveredInEditor
			? `Fresh session created, but implementation did not start: ${detail}. The implementation request is in the editor; submit it or resume the parent planning session.`
			: `Fresh session created, but implementation did not start: ${detail}. The implementation request could not be restored to the editor; resume the parent planning session.`,
		"error",
	);
}

function safeSetEditorText(ctx: Pick<ExtensionContext, "ui">, text: string): boolean {
	try {
		ctx.ui.setEditorText(text);
		return true;
	} catch {
		// A replacement context can become stale while Pi reports a partial handoff.
		return false;
	}
}

// A source context can go stale while the session is being replaced
function safeNotify(ctx: Pick<ExtensionContext, "ui">, message: string, level: "info" | "warning" | "error"): void {
	try {
		ctx.ui.notify(message, level);
	} catch {
		// context already replaced
	}
}

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/extension-runtime.ts (isStaleExtensionContextError)
export function isStaleExtensionContextError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes("This extension ctx is stale after session replacement or reload") ||
			error.message.includes("Extension context is no longer active"))
	);
}

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (safeErrorDetail)
function safeErrorDetail(error: unknown): string {
	const detail = error instanceof Error ? error.message : String(error);
	const normalized =
		[...stripVTControlCharacters(detail)]
			.map((character) => {
				const codePoint = character.codePointAt(0) ?? 0;
				return codePoint <= 0x1f ||
					(codePoint >= 0x7f && codePoint <= 0x9f) ||
					(codePoint >= 0x202a && codePoint <= 0x202e) ||
					(codePoint >= 0x2066 && codePoint <= 0x2069)
					? " "
					: character;
			})
			.join("")
			.replace(/\s+/gu, " ")
			.trim() || "unknown error";
	const characters = [...normalized];
	return characters.length > 500 ? `${characters.slice(0, 499).join("")}…` : normalized;
}
