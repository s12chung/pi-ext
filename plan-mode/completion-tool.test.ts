import { test } from "node:test";
import assert from "node:assert/strict";
import {
	ExplorePhase,
	normalizePlanCompletion,
	phaseTitles,
	planCompleted,
	planCompletionMarkdown,
	planFromCompletionDetails,
	ApprovePhase,
	validPlanText,
} from "./completion-tool.ts";

const PLAN =
	"## 1. Core\nSwap the field.\n\n## 2. Rendering\nHook up the consumer.\n\n## 3. Verification\nmake test.";
const FORMAT_HELP =
	'Expected: numbered markdown phase headings ("## 1. Short title"), numbered sequentially from 1, each followed by its description.';

test("normalizePlanCompletion trims surrounding whitespace", () => {
	assert.deepEqual(normalizePlanCompletion({ plan: `\n${PLAN}\n` }), { ok: true, plan: PLAN });
});

test("normalizePlanCompletion accepts any heading level and 1) numbering", () => {
	assert.equal(normalizePlanCompletion({ plan: "# 1. A\n### 2) B" }).ok, true);
});

test("normalizePlanCompletion rejects a missing or empty plan", () => {
	assert.deepEqual(normalizePlanCompletion("nope"), {
		ok: false,
		error: `plan must be a non-empty string. ${FORMAT_HELP}`,
	});
	assert.deepEqual(normalizePlanCompletion({}), {
		ok: false,
		error: `plan must be a non-empty string. ${FORMAT_HELP}`,
	});
	assert.deepEqual(normalizePlanCompletion({ plan: "  " }), {
		ok: false,
		error: `plan must be a non-empty string. ${FORMAT_HELP}`,
	});
});

test("normalizePlanCompletion rejects a plan without phase headings", () => {
	assert.deepEqual(normalizePlanCompletion({ plan: "Just prose, no headings." }), {
		ok: false,
		error: `plan must contain numbered markdown phase headings, e.g. "## 1. Title". ${FORMAT_HELP}`,
	});
});

test("normalizePlanCompletion enforces the phase-count limit", () => {
	assert.equal(
		normalizePlanCompletion({ plan: Array.from({ length: 10 }, (_, i) => `## ${i + 1}. P${i + 1}`).join("\n") }).ok,
		true,
	);
	assert.equal(
		normalizePlanCompletion({ plan: Array.from({ length: 11 }, (_, i) => `## ${i + 1}. P${i + 1}`).join("\n") }).ok,
		false,
	);
});

test("normalizePlanCompletion rejects out-of-order numbering", () => {
	assert.deepEqual(normalizePlanCompletion({ plan: "## 2. First\n## 3. Second" }), {
		ok: false,
		error: `phase headings must be numbered 1..2 in order (heading 1 is numbered 2). ${FORMAT_HELP}`,
	});
	assert.equal(normalizePlanCompletion({ plan: "## 1. A\n## 3. B" }).ok, false);
});

test("phaseTitles grabs just the heading titles", () => {
	assert.deepEqual(phaseTitles(PLAN), ["Core", "Rendering", "Verification"]);
});

test("planCompleted terminates the turn and round-trips through details", () => {
	const result = planCompleted(PLAN);
	assert.equal(result.terminate, true);
	assert.equal(result.content[0]?.text, `**Proposed Plan**\n\n${PLAN}`);
	assert.equal(planFromCompletionDetails(result.details), PLAN);
});

test("planFromCompletionDetails accepts only matching details", () => {
	assert.equal(planFromCompletionDetails({ version: 2, source: "plan_complete", plan: PLAN }), undefined);
	assert.equal(planFromCompletionDetails({ version: 1, source: "other", plan: PLAN }), undefined);
	assert.equal(planFromCompletionDetails(undefined), undefined);
	assert.equal(planFromCompletionDetails({ version: 1, source: "plan_complete", plan: "no headings" }), undefined);
});

test("validPlanText accepts valid markdown and rejects the rest", () => {
	assert.equal(validPlanText(PLAN), PLAN);
	assert.equal(validPlanText("no headings"), undefined);
	assert.equal(validPlanText(42), undefined);
});

test("planCompletionMarkdown renders the result content", () => {
	const result = planCompleted(PLAN);
	assert.equal(planCompletionMarkdown({ content: result.content }), `**Proposed Plan**\n\n${PLAN}`);
});

test("planCompletionMarkdown returns empty without text content", () => {
	assert.equal(planCompletionMarkdown({ content: [] }), "");
	assert.equal(planCompletionMarkdown({ content: [], details: { version: 2, source: "plan_complete" } }), "");
});

test("explore holds no plan and never prompts for approval", () => {
	const explore = new ExplorePhase();
	assert.equal(explore.id, "explore");
	assert.equal(explore.plan, undefined);
	assert.equal(explore.shouldPromptApproval(), false);
});

test("submitPlan advances explore → approval, menu owed", () => {
	const approval = new ExplorePhase().submitPlan(PLAN);
	assert.equal(approval.id, "approval");
	assert.equal(approval.plan, PLAN);
	assert.equal(approval.shouldPromptApproval(), true);
});

test("a refined plan re-enters approval with the menu owed again", () => {
	const refined = new ApprovePhase(PLAN).submitPlan("## 1. Reworked\nDifferent.\n\n## 2. Verify\nTest.");
	assert.equal(refined.id, "approval");
	assert.equal(refined.plan, "## 1. Reworked\nDifferent.\n\n## 2. Verify\nTest.");
	assert.equal(refined.shouldPromptApproval(), true);
});

test("phase completePlan validates before transitioning", () => {
	assert.throws(() => new ExplorePhase().completePlan({ plan: "just prose" }), /phase headings/);
	const { next, result } = new ExplorePhase().completePlan({ plan: PLAN });
	assert.equal(next.id, "approval");
	assert.equal(next.plan, PLAN);
	assert.equal(result.terminate, true);
	assert.ok(result.content[0]?.text.includes(PLAN));
});
