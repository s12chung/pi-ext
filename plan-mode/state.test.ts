import { test } from "node:test";
import assert from "node:assert/strict";
import { restorePlanModeState } from "./state.ts";

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

const NO_STATE = { enabled: false };

test("returns disabled when no state entry exists", () => {
	assert.deepEqual(restorePlanModeState([]), NO_STATE);
	assert.deepEqual(restorePlanModeState([{ type: "custom", customType: "plan-mode" }]), NO_STATE);
});

test("restores an enabled planning state", () => {
	assert.deepEqual(
		restorePlanModeState(stateEntry({ enabled: true, plan: PLAN, toolsBeforePlanMode: ["read"] })),
		{ enabled: true, plan: PLAN, activePlan: undefined, toolsBeforePlanMode: ["read"] },
	);
});

test("restores a handoff state with plan mode disabled", () => {
	assert.deepEqual(restorePlanModeState(stateEntry({ enabled: false, activePlan: PLAN })), {
		enabled: false,
		plan: undefined,
		activePlan: PLAN,
		toolsBeforePlanMode: undefined,
	});
});

test("recovers the plan from a plan_complete toolResult after the state entry", () => {
	assert.deepEqual(
		restorePlanModeState(
			stateEntry({ enabled: true }, planCompleteResult({ version: 1, source: "plan_complete", plan: PLAN })),
		),
		{ enabled: true, plan: PLAN, activePlan: undefined, toolsBeforePlanMode: undefined },
	);
});

test("ignores plan_complete toolResults before the state entry", () => {
	assert.deepEqual(
		restorePlanModeState([
			planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. Old" }),
			...stateEntry({ enabled: true }),
		]),
		{ enabled: true, plan: undefined, activePlan: undefined, toolsBeforePlanMode: undefined },
	);
});

test("newest plan_complete toolResult wins", () => {
	const entries = stateEntry(
		{ enabled: true },
		planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. First" }),
		assistantEntry,
		planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. Second" }),
	);
	assert.deepEqual(restorePlanModeState(entries).plan, "## 1. Second");
});

test("invalid persisted plan falls back to toolResult recovery", () => {
	const entries = stateEntry(
		{ enabled: true, plan: "  " },
		planCompleteResult({ version: 1, source: "plan_complete", plan: PLAN }),
	);
	assert.deepEqual(restorePlanModeState(entries).plan, PLAN);
});

test("persisted plan without phase headings is ignored", () => {
	assert.deepEqual(restorePlanModeState(stateEntry({ enabled: true, plan: "just prose" })), {
		enabled: true,
		plan: undefined,
		activePlan: undefined,
		toolsBeforePlanMode: undefined,
	});
});

test("disabled state ignores persisted plan", () => {
	assert.equal(restorePlanModeState(stateEntry({ enabled: false, plan: "## 1. Stale" })).plan, undefined);
});

test("ignores toolResults from other tools", () => {
	const bashResult = {
		type: "message",
		message: { role: "toolResult", toolName: "bash", details: { version: 1, source: "plan_complete", plan: PLAN } },
	};
	assert.equal(restorePlanModeState(stateEntry({ enabled: true }, bashResult)).plan, undefined);
});
