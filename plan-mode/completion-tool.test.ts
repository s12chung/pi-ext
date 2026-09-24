import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlanCompletion, planCompleted, planCompletionMarkdown, stepsFromCompletionDetails } from "./completion-tool.ts";

test("normalizePlanCompletion trims step text", () => {
	assert.deepEqual(normalizePlanCompletion({ steps: [" a ", "b"] }), { ok: true, steps: ["a", "b"] });
});

test("normalizePlanCompletion rejects an empty steps array", () => {
	assert.deepEqual(normalizePlanCompletion({ steps: [] }), { ok: false, error: "steps must not be empty" });
});

test("normalizePlanCompletion rejects whitespace-only steps", () => {
	assert.deepEqual(normalizePlanCompletion({ steps: ["ok", "  "] }), {
		ok: false,
		error: "each step must be a non-empty string",
	});
});

test("normalizePlanCompletion rejects non-string steps", () => {
	assert.deepEqual(normalizePlanCompletion({ steps: ["ok", 5] }), {
		ok: false,
		error: "each step must be a non-empty string",
	});
});

test("normalizePlanCompletion rejects non-record input", () => {
	assert.deepEqual(normalizePlanCompletion("nope"), { ok: false, error: "steps must be an array of strings" });
	assert.deepEqual(normalizePlanCompletion({}), { ok: false, error: "steps must be an array of strings" });
});

test("normalizePlanCompletion enforces the step-count limit", () => {
	assert.equal(normalizePlanCompletion({ steps: Array<string>(50).fill("x") }).ok, true);
	assert.equal(normalizePlanCompletion({ steps: Array<string>(51).fill("x") }).ok, false);
});

test("stepsFromCompletionDetails accepts only matching details", () => {
	assert.deepEqual(stepsFromCompletionDetails({ version: 1, source: "plan_complete", steps: ["a", "b"] }), [
		"a",
		"b",
	]);
	assert.equal(stepsFromCompletionDetails({ version: 2, source: "plan_complete", steps: ["a"] }), undefined);
	assert.equal(stepsFromCompletionDetails({ version: 1, source: "other", steps: ["a"] }), undefined);
	assert.equal(stepsFromCompletionDetails(undefined), undefined);
	assert.equal(stepsFromCompletionDetails({ version: 1, source: "plan_complete", steps: [] }), undefined);
});

test("planCompleted terminates the turn and round-trips through details", () => {
	const result = planCompleted(["a", "b"]);
	assert.equal(result.terminate, true);
	assert.equal(result.content[0]?.text, "**Proposed Plan**\n\n1. a\n2. b");
	assert.deepEqual(stepsFromCompletionDetails(result.details), ["a", "b"]);
});

test("planCompletionMarkdown renders the result content", () => {
	const result = planCompleted(["a", "b"]);
	assert.equal(planCompletionMarkdown({ content: result.content }), "**Proposed Plan**\n\n1. a\n2. b");
});

test("planCompletionMarkdown falls back to details when content is empty", () => {
	assert.equal(
		planCompletionMarkdown({ content: [], details: { version: 1, source: "plan_complete", steps: ["a", "b"] } }),
		"**Proposed Plan**\n\n1. a\n2. b",
	);
});

test("planCompletionMarkdown returns empty without content or details", () => {
	assert.equal(planCompletionMarkdown({ content: [] }), "");
	assert.equal(planCompletionMarkdown({ content: [], details: { version: 2, source: "plan_complete" } }), "");
});
