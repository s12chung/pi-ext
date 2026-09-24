import assert from "node:assert/strict";
import { test } from "node:test";
import { setIdleBorderColor, setPlanBorderColor, tintPlanBorders } from "./border-tint.ts";

function fakeEditor() {
	return {
		borderColor: (text: string) => `<b>${text}</b>`,
	};
}

test("border stays stock while inactive and tracks reassignment", () => {
	const editor = fakeEditor();
	const active = { value: false };
	tintPlanBorders(editor, () => active.value);
	assert.equal(editor.borderColor("──"), "<b>──</b>");
	editor.borderColor = (text: string) => `<thinking>${text}</thinking>`;
	assert.equal(editor.borderColor("──"), "<thinking>──</thinking>");
});

test("active border reads the plan color over heavy rails and survives clobbering", () => {
	const editor = fakeEditor();
	const active = { value: false };
	tintPlanBorders(editor, () => active.value);
	setPlanBorderColor((text) => `<plan>${text}</plan>`);
	active.value = true;
	assert.equal(editor.borderColor("──"), "<plan>━━</plan>");
	editor.borderColor = (text: string) => `<thinking>${text}</thinking>`;
	assert.equal(editor.borderColor("──"), "<plan>━━</plan>");
	active.value = false;
	assert.equal(editor.borderColor("──"), "<thinking>──</thinking>");
});

test("arrows and labels inside the border survive thickening", () => {
	const editor = fakeEditor();
	tintPlanBorders(editor, () => true);
	setPlanBorderColor((text) => `<plan>${text}</plan>`);
	assert.equal(editor.borderColor("─ ↑ 3 ─"), "<plan>━ ↑ 3 ━</plan>");
});

test("idle border color can emulate a theme UI's static look", () => {
	const editor = fakeEditor();
	const active = { value: false };
	tintPlanBorders(editor, () => active.value);
	setIdleBorderColor((text) => `<gray>${text}</gray>`);
	assert.equal(editor.borderColor("──"), "<gray>──</gray>");
	setPlanBorderColor((text) => `<plan>${text}</plan>`);
	active.value = true;
	assert.equal(editor.borderColor("──"), "<plan>━━</plan>");
	active.value = false;
	assert.equal(editor.borderColor("──"), "<gray>──</gray>");
});
