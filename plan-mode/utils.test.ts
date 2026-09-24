import { test } from "node:test";
import assert from "node:assert/strict";
import { getNormalModeTools, getPlanModeTools, unsafeCommandReason, withRequiredPlanModeTools } from "./utils.ts";

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

// The one canonical explore child the plan-mode prompt teaches; only this
// pi shape passes the allowlist
const EXPLORE_CHILD =
	'pi --print --no-extensions --no-session --tools read,grep,find,ls "trace config loading - report findings"';

test("unsafeCommandReason allows the canonical read-only explore child", () => {
	assert.equal(unsafeCommandReason(EXPLORE_CHILD), undefined);
});

test("unsafeCommandReason blocks pi children without the read-only shape", () => {
	assert.equal(unsafeCommandReason('pi -p "explore"'), "no safe allowlist pattern matched");
	assert.equal(
		unsafeCommandReason('pi --print --no-extensions --no-session --tools edit,write "x"'),
		"no safe allowlist pattern matched",
	);
});

test("unsafeCommandReason reports destructive or unmatched commands", () => {
	assert.match(unsafeCommandReason("rm -rf /") ?? "", /destructive pattern/);
	assert.equal(unsafeCommandReason("python3 script.py"), "no safe allowlist pattern matched");
});

test("unsafeCommandReason allows /dev/null redirect sinks", () => {
	assert.equal(unsafeCommandReason("grep foo bar 2>/dev/null"), undefined);
	assert.equal(unsafeCommandReason("grep foo bar 2> /dev/null"), undefined);
	assert.equal(unsafeCommandReason("grep -rn foo . >/dev/null | head -5"), undefined);
});

test("unsafeCommandReason still blocks file-writing redirects", () => {
	assert.match(unsafeCommandReason("echo hi > out.txt") ?? "", /destructive pattern/);
	assert.match(unsafeCommandReason("grep foo bar > /dev/null.txt") ?? "", /destructive pattern/);
});

test("unsafeCommandReason allows read-only go commands", () => {
	assert.equal(unsafeCommandReason("go doc os.ReadFile"), undefined);
	assert.equal(unsafeCommandReason("go env GOPATH"), undefined);
	assert.equal(unsafeCommandReason("go env -w GOFLAGS=-mod=mod"), "no safe allowlist pattern matched");
});
