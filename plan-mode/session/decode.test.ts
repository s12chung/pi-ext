import assert from "node:assert/strict"
import { test } from "node:test"
import type { AgentToolResult } from "@earendil-works/pi-coding-agent"
import { PLAN, entryBase, stateEntry, userEntry } from "../utils/fixtures.ts"
import { decodedMode, toolResultText } from "./decode.ts"

test("decodedState returns no state without a plan-mode entry", () => {
  assert.equal(decodedMode([]), undefined)
  assert.equal(decodedMode([userEntry]), undefined)
})

test("decodedState decodes every planning-state field", () => {
  assert.deepEqual(decodedMode(stateEntry({ mode: "planning", plan: PLAN })), {
    mode: "planning",
    plan: PLAN,
  })
})

test("decodedState decodes default-state fields and drops the legacy enabled shape", () => {
  assert.deepEqual(decodedMode(stateEntry({ mode: "default" })), {
    mode: "default",
    plan: undefined,
  })

  // The enabled boolean and the stale tool snapshot no longer migrate:
  // decode follows mode and plan only
  assert.deepEqual(
    decodedMode(stateEntry({ enabled: true, plan: PLAN, toolsBeforePlanMode: ["read"] })),
    { mode: "default", plan: PLAN },
  )
})

test("decodedState narrows structurally and drops unknown-shaped fields", () => {
  assert.deepEqual(
    decodedMode(
      stateEntry({
        mode: "planning",
        futureField: "bogus",
        plan: 42,
        toolsBeforePlanMode: ["read", "", 7],
      }),
    ),
    { mode: "planning", plan: undefined },
  )
})

test("decodedState keeps plan content without re-validating it", () => {
  // The plan was validated before it was persisted; a JSON round-trip cannot
  // invalidate a string
  assert.equal(
    decodedMode(stateEntry({ mode: "planning", plan: "no headings" }))?.plan,
    "no headings",
  )
})

test("decodedState returns undefined for a non-record payload", () => {
  assert.equal(
    decodedMode([{ type: "custom", customType: "plan-mode", data: "garbage", ...entryBase }]),
    undefined,
  )
})

// Source (adapted: planModeCompletionMarkdown → toolResultText):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
test("toolResultText joins text blocks, trims, and skips other block types", () => {
  const result = {
    content: [
      { type: "text", text: "  **Proposed Plan**\n" },
      { type: "image" },
      { type: "text", text: "\nbody  " },
    ],
  } as unknown as AgentToolResult<never>
  assert.equal(toolResultText(result), "**Proposed Plan**\n\n\nbody")
})

test("toolResultText returns empty without text content", () => {
  assert.equal(toolResultText({ content: [], details: undefined }), "")
})
