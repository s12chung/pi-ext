import { test } from "node:test";
import assert from "node:assert/strict";
import { getNormalModeTools, getPlanModeTools, withRequiredPlanModeTools } from "./utils.ts";

// pi auto-activates every registerTool() call, so a normal-mode startup set carries
// plan_complete and the bundled questionnaire tool alongside the ordinary tools
const STARTUP_TOOLS = ["read", "bash", "edit", "write", "plan_complete", "questionnaire", "other-ext-tool"];

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/test/tool-policy.test.ts (withRequiredPlanModeTools)
test("withRequiredPlanModeTools strips then appends the helpers in canonical order", () => {
	assert.deepEqual(withRequiredPlanModeTools(["read", "questionnaire", "read"]), [
		"read",
		"questionnaire",
		"plan_complete",
	]);
});

test("plan mode tools add the helpers and drop the write tools", () => {
	const tools = getPlanModeTools(STARTUP_TOOLS);
	assert.equal(tools.includes("plan_complete"), true);
	assert.equal(tools.includes("questionnaire"), true);
	assert.equal(tools.includes("edit"), false);
	assert.equal(tools.includes("write"), false);
	assert.equal(tools.includes("other-ext-tool"), true);
});

test("normal mode tools strip the plan helpers wherever they came from", () => {
	const tools = getNormalModeTools(STARTUP_TOOLS);
	assert.equal(tools.includes("plan_complete"), false);
	assert.equal(tools.includes("questionnaire"), false);
	assert.equal(tools.includes("edit"), true);
	assert.equal(tools.includes("write"), true);
	assert.equal(tools.includes("other-ext-tool"), true);
});

test("tool sets stay duplicate-free across repeated toggles", () => {
	const planned = getPlanModeTools(getNormalModeTools(getPlanModeTools(STARTUP_TOOLS)));
	const restored = getNormalModeTools(getPlanModeTools(STARTUP_TOOLS));
	assert.equal(new Set(planned).size, planned.length);
	assert.equal(new Set(restored).size, restored.length);
});
