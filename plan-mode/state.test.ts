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

const NO_STATE = { enabled: false };

test("returns disabled when no state entry exists", () => {
	assert.deepEqual(restorePlanModeState([]), NO_STATE);
	assert.deepEqual(restorePlanModeState([{ type: "custom", customType: "plan-mode" }]), NO_STATE);
});

test("restores an enabled planning state", () => {
	assert.deepEqual(
		restorePlanModeState(stateEntry({ enabled: true, planSteps: ["x"], toolsBeforePlanMode: ["read"] })),
		{ enabled: true, planSteps: ["x"], activeSteps: undefined, toolsBeforePlanMode: ["read"] },
	);
});

test("restores a handoff state with plan mode disabled", () => {
	assert.deepEqual(restorePlanModeState(stateEntry({ enabled: false, activeSteps: ["y"] })), {
		enabled: false,
		planSteps: undefined,
		activeSteps: ["y"],
		toolsBeforePlanMode: undefined,
	});
});

test("recovers steps from a plan_complete toolResult after the state entry", () => {
	assert.deepEqual(
		restorePlanModeState(stateEntry({ enabled: true }, planCompleteResult({ version: 1, source: "plan_complete", steps: ["r1"] }))),
		{ enabled: true, planSteps: ["r1"], activeSteps: undefined, toolsBeforePlanMode: undefined },
	);
});

test("ignores plan_complete toolResults before the state entry", () => {
	assert.deepEqual(
		restorePlanModeState([planCompleteResult({ version: 1, source: "plan_complete", steps: ["old"] }), ...stateEntry({ enabled: true })]),
		{ enabled: true, planSteps: undefined, activeSteps: undefined, toolsBeforePlanMode: undefined },
	);
});

test("newest plan_complete toolResult wins", () => {
	const entries = stateEntry(
		{ enabled: true },
		planCompleteResult({ version: 1, source: "plan_complete", steps: ["first"] }),
		assistantEntry,
		planCompleteResult({ version: 1, source: "plan_complete", steps: ["second"] }),
	);
	assert.deepEqual(restorePlanModeState(entries).planSteps, ["second"]);
});

test("invalid persisted steps fall back to toolResult recovery", () => {
	const entries = stateEntry(
		{ enabled: true, planSteps: ["a", ""] },
		planCompleteResult({ version: 1, source: "plan_complete", steps: ["rec"] }),
	);
	assert.deepEqual(restorePlanModeState(entries).planSteps, ["rec"]);
});

test("disabled state ignores persisted planSteps", () => {
	assert.equal(restorePlanModeState(stateEntry({ enabled: false, planSteps: ["stale"] })).planSteps, undefined);
});

test("ignores toolResults from other tools", () => {
	const bashResult = {
		type: "message",
		message: { role: "toolResult", toolName: "bash", details: { version: 1, source: "plan_complete", steps: ["nope"] } },
	};
	assert.equal(restorePlanModeState(stateEntry({ enabled: true }, bashResult)).planSteps, undefined);
});
