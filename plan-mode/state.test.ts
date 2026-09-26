import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ApprovePhase } from "./completion-tool.ts";
import { presentApproval, promptPlanApproval, restoreMode, setMode, type ModeSlot } from "./state.ts";
import { DefaultMode, isDefaultMode, isPlanningMode, PlanningMode } from "./mode.ts";

// Minimal session-entry builders mirroring the shapes pi persists
const stateEntry = (data: unknown, ...after: unknown[]) => [
	{ type: "custom", customType: "plan-mode", data },
	...after,
];
const planCompleteResult = (details: unknown) => ({
	type: "message",
	message: { role: "toolResult", toolName: "plan_complete", details },
});
const assistantEntry = { type: "message", message: { role: "assistant", content: [] } };

const PLAN = "## 1. Core\nSwap the field.\n\n## 2. Verification\nmake test.";

test("returns default when no state entry exists", () => {
	assert.ok(isDefaultMode(restoreMode([])));
	assert.ok(isDefaultMode(restoreMode([{ type: "custom", customType: "plan-mode" }])));
});

test("restores a planning state in approval with its plan", () => {
	const mode = restoreMode(stateEntry({ mode: "planning", phase: "approval", plan: PLAN, toolsBeforePlanMode: ["read"] }));
	assert.ok(isPlanningMode(mode));
	assert.equal(mode.phase.id, "approval");
	assert.equal(mode.plan, PLAN);
	assert.deepEqual(mode.toolsBeforePlanMode, ["read"]);
});

test("restores an explore planning state without a plan", () => {
	const mode = restoreMode(stateEntry({ mode: "planning", phase: "explore" }));
	assert.ok(isPlanningMode(mode));
	assert.equal(mode.phase.id, "explore");
	assert.equal(mode.plan, undefined);
});

test("restores a handoff default state with activePlan", () => {
	const mode = restoreMode(stateEntry({ mode: "default", activePlan: PLAN }));
	assert.ok(isDefaultMode(mode));
	assert.equal(mode.activePlan, PLAN);
	assert.equal(mode.toolsBeforePlanMode, undefined);
});

test("recovers the plan from a plan_complete toolResult after the state entry", () => {
	const mode = restoreMode(
		stateEntry({ mode: "planning", phase: "explore" }, planCompleteResult({ version: 1, source: "plan_complete", plan: PLAN })),
	);
	assert.ok(isPlanningMode(mode));
	assert.equal(mode.plan, PLAN);
	assert.equal(mode.phase.id, "approval");
});

test("ignores plan_complete toolResults before the state entry", () => {
	const mode = restoreMode([
		planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. Old" }),
		...stateEntry({ mode: "planning" }),
	]);
	assert.ok(isPlanningMode(mode));
	assert.equal(mode.plan, undefined);
});

test("newest plan_complete toolResult wins", () => {
	const entries = stateEntry(
		{ mode: "planning" },
		planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. First" }),
		assistantEntry,
		planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. Second" }),
	);
	assert.equal((restoreMode(entries) as PlanningMode).plan, "## 1. Second");
});

test("invalid persisted plan falls back to toolResult recovery", () => {
	const entries = stateEntry(
		{ mode: "planning", phase: "approval", plan: "  " },
		planCompleteResult({ version: 1, source: "plan_complete", plan: PLAN }),
	);
	assert.equal((restoreMode(entries) as PlanningMode).plan, PLAN);
});

test("persisted plan without phase headings is ignored", () => {
	const mode = restoreMode(stateEntry({ mode: "planning", phase: "approval", plan: "just prose" }));
	assert.ok(isPlanningMode(mode));
	assert.equal(mode.plan, undefined);
	assert.equal(mode.phase.id, "explore");
});

test("default state ignores a persisted planning plan", () => {
	assert.equal((restoreMode(stateEntry({ mode: "default", plan: "## 1. Stale", activePlan: PLAN })) as DefaultMode).activePlan, PLAN);
	assert.equal((restoreMode(stateEntry({ enabled: false, plan: "## 1. Stale" })) as DefaultMode).activePlan, undefined);
});

test("ignores toolResults from other tools", () => {
	const bashResult = {
		type: "message",
		message: { role: "toolResult", toolName: "bash", details: { version: 1, source: "plan_complete", plan: PLAN } },
	};
	assert.equal(restoreMode(stateEntry({ mode: "planning" }, bashResult)).shouldPromptApproval(), false);
});

test("migrates the pre-mode-objects enabled shape", () => {
	const planning = restoreMode(stateEntry({ enabled: true, plan: PLAN, toolsBeforePlanMode: ["read"] }));
	assert.ok(isPlanningMode(planning));
	assert.equal(planning.phase.id, "approval");
	assert.equal(planning.plan, PLAN);
	assert.deepEqual(planning.toolsBeforePlanMode, ["read"]);

	const handoff = restoreMode(stateEntry({ enabled: false, activePlan: PLAN }));
	assert.ok(isDefaultMode(handoff));
	assert.equal(handoff.activePlan, PLAN);
});

test("toState round-trips through restoreMode", () => {
	const planning = new PlanningMode();
	planning.phase = new ApprovePhase(PLAN);
	planning.toolsBeforePlanMode = ["read"];
	assert.deepEqual(restoreMode(stateEntry(planning.toState())).toState(), planning.toState());

	const handoff = new DefaultMode(PLAN);
	assert.deepEqual(restoreMode(stateEntry(handoff.toState())).toState(), handoff.toState());
});

function planningWithPlan(): PlanningMode {
	const planning = new PlanningMode();
	planning.phase = new ApprovePhase(PLAN);
	return planning;
}

// Fakes covering what mode enter()/promptPlanApproval touch; hasUI stays off
// so ensureBorderTint skips the editor wrap
function approvalFixture(
	choice: string | undefined,
	options?: { onMenu?: () => void; editor?: () => Promise<string | undefined> },
) {
	const entries: unknown[] = [];
	const sent: Array<Record<string, unknown>> = [];
	const slot: ModeSlot = { mode: planningWithPlan(), rev: 1 };
	const pi = {
		getActiveTools: () => ["read", "bash", "edit", "write"],
		setActiveTools: () => {},
		appendEntry: (_customType: string, data: unknown) => entries.push(data),
		sendMessage: (message: Record<string, unknown>) => sent.push(message),
		sendUserMessage: (text: string) => sent.push({ customType: "user", content: text }),
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: false,
		ui: {
			select: async () => {
				options?.onMenu?.();
				return choice;
			},
			editor: options?.editor ?? (async () => undefined),
			notify: () => {},
			setStatus: () => {},
			setEditorText: () => {},
			theme: { fg: (_role: string, text: string) => text },
		},
	} as unknown as ExtensionContext;
	return { pi, ctx, slot, entries, sent };
}

test("setMode swaps, enters, and persists the successor", () => {
	const { pi, ctx, slot, entries } = approvalFixture(undefined);
	const planning = slot.mode as PlanningMode;
	planning.toolsBeforePlanMode = ["read"];
	setMode(pi, ctx, slot, planning.next());
	assert.ok(isDefaultMode(slot.mode));
	assert.deepEqual(entries, [{ mode: "default", activePlan: undefined, toolsBeforePlanMode: ["read"] }]);
});

test("approval menu: stay opens the refinement editor, empty keeps planning", async () => {
	const { pi, ctx, slot, entries, sent } = approvalFixture("Stay and refine the plan");
	await promptPlanApproval(pi, ctx, undefined, slot);
	assert.ok(isPlanningMode(slot.mode));
	assert.deepEqual(entries, []);
	assert.deepEqual(sent, []);
});

test("approval menu: exit swaps to default and persists", async () => {
	const { pi, ctx, slot, entries } = approvalFixture("Exit plan mode (plan stays in context)");
	await promptPlanApproval(pi, ctx, undefined, slot);
	assert.ok(isDefaultMode(slot.mode));
	assert.equal(entries.length, 1);
	assert.equal((entries[0] as { mode: string }).mode, "default");
});

test("approval menu: stay sends the refinement as a follow-up", async () => {
	const { pi, ctx, slot, sent } = approvalFixture("Stay and refine the plan", {
		editor: async () => "make it faster",
	});
	await promptPlanApproval(pi, ctx, undefined, slot);
	assert.ok(isPlanningMode(slot.mode));
	assert.deepEqual(sent, [{ customType: "user", content: "make it faster" }]);
});

test("approval menu: bails when the session was replaced while open", async () => {
	const { pi, ctx, slot, entries } = approvalFixture("Exit plan mode (plan stays in context)", {
		onMenu: () => {
			slot.rev += 1;
		},
	});
	await promptPlanApproval(pi, ctx, undefined, slot);
	assert.ok(isPlanningMode(slot.mode));
	assert.deepEqual(entries, []);
});

test("approval menu: bails when the plan was superseded while open", async () => {
	const { pi, ctx, slot, entries } = approvalFixture("Exit plan mode (plan stays in context)", {
		onMenu: () => {
			const superseded = planningWithPlan();
			superseded.phase = new ApprovePhase("## 1. Reworked\nA different plan.");
			slot.mode = superseded;
		},
	});
	await promptPlanApproval(pi, ctx, undefined, slot);
	assert.ok(isPlanningMode(slot.mode));
	assert.deepEqual(entries, []);
});

test("approval menu: without a plan it never opens", async () => {
	const { pi, ctx, slot, sent } = approvalFixture("Exit plan mode (plan stays in context)");
	slot.mode = new PlanningMode();
	await promptPlanApproval(pi, ctx, undefined, slot);
	assert.deepEqual(sent, []);
});

test("presentApproval swallows stale-context errors and rethrows others", async () => {
	const { pi, ctx, slot, entries } = approvalFixture(undefined);
	let thrown: Error | undefined;
	const select = ctx.ui.select.bind(ctx.ui);
	(ctx.ui as { select: unknown }).select = async () => {
		if (thrown) throw thrown;
		return await select("", []);
	};

	thrown = new Error("This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx.");
	await presentApproval(pi, ctx, undefined, slot);
	assert.ok(isPlanningMode(slot.mode));
	assert.deepEqual(entries, []);

	thrown = new Error("boom");
	slot.mode = planningWithPlan(); // the first call consumed the approval phase
	await assert.rejects(presentApproval(pi, ctx, undefined, slot), /boom/);
});
