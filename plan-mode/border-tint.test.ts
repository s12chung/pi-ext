import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import {
  type BorderColoredEditor,
  ensureBorderTint,
  setPlanBorderActive,
  tintPlanBorders,
} from "./border-tint.ts"

function fakeEditor(): { borderColor: (text: string) => string } {
  return {
    borderColor: (text: string): string => `<b>${text}</b>`,
  }
}

function plan(text: string): string {
  return `<plan>${text}</plan>`
}

test("border stays stock while inactive and tracks reassignment", () => {
  const editor = fakeEditor()
  const active = { value: false }
  tintPlanBorders(editor, () => active.value, plan)
  assert.equal(editor.borderColor("──"), "<b>──</b>")
  editor.borderColor = (text: string): string => `<thinking>${text}</thinking>`
  assert.equal(editor.borderColor("──"), "<thinking>──</thinking>")
})

test("active border reads the plan color over heavy rails and survives clobbering", () => {
  const editor = fakeEditor()
  const active = { value: false }
  tintPlanBorders(editor, () => active.value, plan)
  active.value = true
  assert.equal(editor.borderColor("──"), "<plan>━━</plan>")
  editor.borderColor = (text: string): string => `<thinking>${text}</thinking>`
  assert.equal(editor.borderColor("──"), "<plan>━━</plan>")
  active.value = false
  assert.equal(editor.borderColor("──"), "<thinking>──</thinking>")
})

test("arrows and labels inside the border survive thickening", () => {
  const editor = fakeEditor()
  tintPlanBorders(editor, () => true, plan)
  assert.equal(editor.borderColor("─ ↑ 3 ─"), "<plan>━ ↑ 3 ━</plan>")
})

test("idle border color can emulate a theme UI's static look", () => {
  const editor = fakeEditor()
  const active = { value: false }
  tintPlanBorders(
    editor,
    () => active.value,
    plan,
    (text) => `<gray>${text}</gray>`,
  )
  assert.equal(editor.borderColor("──"), "<gray>──</gray>")
  active.value = true
  assert.equal(editor.borderColor("──"), "<plan>━━</plan>")
  active.value = false
  assert.equal(editor.borderColor("──"), "<gray>──</gray>")
})

test("ensureBorderTint wraps the installed factory once and follows plan-active flips", () => {
  const editor = fakeEditor()
  const base = (): BorderColoredEditor => editor
  let installed: unknown
  const ctx = {
    hasUI: true,
    ui: {
      getEditorComponent: () => (installed === undefined ? base : (installed as typeof base)),
      setEditorComponent: (factory: unknown) => {
        installed = factory
      },
      theme: { fg: (_role: string, text: string) => `<t>${text}</t>` },
    },
  } as unknown as ExtensionContext

  ensureBorderTint(ctx)
  assert.notEqual(installed, base)

  const wrapped = (
    installed as (tui: unknown, theme: unknown, keybindings: unknown) => BorderColoredEditor
  )({}, {}, {})
  setPlanBorderActive(false)
  assert.equal(wrapped.borderColor?.("──"), "<b>──</b>")
  setPlanBorderActive(true)
  assert.equal(wrapped.borderColor?.("──"), "<t>━━</t>")

  // Idempotent: the already-installed factory is not wrapped again
  ensureBorderTint(ctx)
  setPlanBorderActive(false)
  assert.equal(wrapped.borderColor?.("──"), "<b>──</b>")
})
