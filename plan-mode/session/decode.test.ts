import assert from "node:assert/strict"
import { test } from "node:test"
import type { AgentToolResult, SessionEntry } from "@earendil-works/pi-coding-agent"
import {
  PLAN,
  entryBase,
  planCompleteResult,
  stateEntry,
  toolResultEntry,
  userEntry,
} from "../utils/fixtures.ts"
import { decodedMode, endedOnPlanCompletion, toolResultText } from "./decode.ts"

test("decodedState returns no state without a plan-mode entry", () => {
  assert.equal(decodedMode([]), undefined)
  assert.equal(decodedMode([userEntry]), undefined)
})

test("decodedState decodes every planning-state field", () => {
  assert.deepEqual(decodedMode(stateEntry({ mode: "planning", plan: PLAN })), {
    mode: "planning",
    plan: PLAN,
    modelInfo: undefined,
  })
})

test("decodedState decodes default-state fields and drops the legacy enabled shape", () => {
  assert.deepEqual(decodedMode(stateEntry({ mode: "default" })), {
    mode: "default",
    plan: undefined,
    modelInfo: undefined,
  })

  // The enabled boolean and the stale tool snapshot no longer migrate:
  // decode follows mode, plan, and model info only
  assert.deepEqual(
    decodedMode(stateEntry({ enabled: true, plan: PLAN, toolsBeforePlanMode: ["read"] })),
    { mode: "default", plan: PLAN, modelInfo: undefined },
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
    { mode: "planning", plan: undefined, modelInfo: undefined },
  )
})

test("decodedState decodes a transferred runtime", () => {
  assert.deepEqual(
    decodedMode(
      stateEntry({
        mode: "default",
        modelInfo: {
          model: { provider: "anthropic", id: "planning-model" },
          thinkingLevel: "high",
        },
      }),
    ),
    {
      mode: "default",
      plan: undefined,
      modelInfo: { model: { provider: "anthropic", id: "planning-model" }, thinkingLevel: "high" },
    },
  )
})

test("decodedState narrows the model info and drops its unknown-shaped fields", () => {
  assert.deepEqual(
    decodedMode(
      stateEntry({
        mode: "default",
        modelInfo: { model: { provider: "anthropic", id: "x" }, plan: 42 },
      }),
    )?.modelInfo,
    { model: { provider: "anthropic", id: "x" }, thinkingLevel: undefined },
  )

  // Model info without a decodable model is no model info at all
  assert.equal(
    decodedMode(stateEntry({ mode: "default", modelInfo: { thinkingLevel: "high", plan: 42 } }))
      ?.modelInfo,
    undefined,
  )
  assert.equal(
    decodedMode(
      stateEntry({
        mode: "default",
        modelInfo: { model: { provider: 1, id: "planning-model" }, thinkingLevel: "turbo" },
      }),
    )?.modelInfo,
    undefined,
  )
  assert.equal(
    decodedMode(stateEntry({ mode: "default", modelInfo: { model: "anthropic" } }))?.modelInfo,
    undefined,
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

// A bookkeeping entry pi may append after a turn's messages: never speaks for
// the run, so the gate skips past it to the newest message
const usageEntry: SessionEntry = {
  type: "usage",
  kind: "agent",
  provider: "anthropic",
  model: "claude",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  ...entryBase,
}

test("endedOnPlanCompletion is true only while the completion result is the newest message", () => {
  assert.equal(endedOnPlanCompletion([planCompleteResult({ source: "plan_complete" })]), true)
  assert.equal(endedOnPlanCompletion([planCompleteResult({}), usageEntry]), true)
  assert.equal(
    endedOnPlanCompletion(stateEntry({ mode: "planning" }, planCompleteResult({}))),
    true,
  )
})

test("endedOnPlanCompletion is false once any turn lands past the completion", () => {
  assert.equal(endedOnPlanCompletion([planCompleteResult({}), userEntry]), false)
  assert.equal(endedOnPlanCompletion([userEntry]), false)
  assert.equal(endedOnPlanCompletion([toolResultEntry("read")]), false)
  assert.equal(endedOnPlanCompletion([usageEntry]), false)
  assert.equal(endedOnPlanCompletion([]), false)
})

test("toolResultText returns empty without text content", () => {
  assert.equal(toolResultText({ content: [], details: undefined }), "")
})
