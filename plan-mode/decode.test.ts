import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import { decodeSession } from "./decode.ts"
import { PLAN, entryBase, planCompleteResult, stateEntry } from "./fixtures.ts"

test("decodeSession returns no state without a plan-mode entry", () => {
  assert.equal(decodeSession([]).state, undefined)
  const userMessage: SessionEntry = {
    type: "message",
    ...entryBase,
    message: { role: "user", content: "hi", timestamp: 0 },
  }
  assert.equal(decodeSession([userMessage]).state, undefined)
})

test("decodeSession decodes every planning-state field", () => {
  const { state } = decodeSession(
    stateEntry({ mode: "planning", phase: "approval", plan: PLAN, toolsBeforePlanMode: ["read"] }),
  )
  assert.deepEqual(state, {
    mode: "planning",
    phase: "approval",
    plan: PLAN,
    activePlan: undefined,
    toolsBeforePlanMode: ["read"],
  })
})

test("decodeSession decodes default-state fields and migrates the legacy enabled shape", () => {
  const { state } = decodeSession(stateEntry({ mode: "default", activePlan: PLAN }))
  assert.deepEqual(state, {
    mode: "default",
    phase: undefined,
    plan: undefined,
    activePlan: PLAN,
    toolsBeforePlanMode: undefined,
  })

  const legacy = decodeSession(
    stateEntry({ enabled: true, plan: PLAN, toolsBeforePlanMode: ["read"] }),
  ).state
  assert.deepEqual(legacy, {
    mode: "planning",
    phase: undefined,
    plan: PLAN,
    activePlan: undefined,
    toolsBeforePlanMode: ["read"],
  })
})

test("decodeSession drops invalid field values", () => {
  const { state } = decodeSession(
    stateEntry({
      mode: "planning",
      phase: "bogus",
      plan: "no headings",
      activePlan: 42,
      toolsBeforePlanMode: ["read", "", 7],
    }),
  )
  assert.deepEqual(state, {
    mode: "planning",
    phase: undefined,
    plan: undefined,
    activePlan: undefined,
    toolsBeforePlanMode: undefined,
  })
})

test("decodeSession recovers the newest plan_complete toolResult after the state entry", () => {
  const decoded = decodeSession(
    stateEntry(
      { mode: "planning" },
      planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. First" }),
      planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. Second" }),
    ),
  )
  assert.equal(decoded.completionPlan, "## 1. Second")
})

test("decodeSession ignores toolResults before the state entry", () => {
  const decoded = decodeSession([
    planCompleteResult({ version: 1, source: "plan_complete", plan: PLAN }),
    ...stateEntry({ mode: "planning" }),
  ])
  assert.equal(decoded.completionPlan, undefined)
})

test("decodeSession vets toolResult details identity", () => {
  const wrongVersion = decodeSession(
    stateEntry(
      { mode: "planning" },
      planCompleteResult({ version: 2, source: "plan_complete", plan: PLAN }),
    ),
  )
  assert.equal(wrongVersion.completionPlan, undefined)

  const wrongSource = decodeSession(
    stateEntry(
      { mode: "planning" },
      planCompleteResult({ version: 1, source: "other", plan: PLAN }),
    ),
  )
  assert.equal(wrongSource.completionPlan, undefined)

  const invalidPlan = decodeSession(
    stateEntry(
      { mode: "planning" },
      planCompleteResult({ version: 1, source: "plan_complete", plan: "no headings" }),
    ),
  )
  assert.equal(invalidPlan.completionPlan, undefined)
})
