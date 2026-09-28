import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import { DefaultMode, type Mode, PlanningMode, promptPlanApproval } from "../mode.ts"
import { PLAN, entryBase, planCompleteResult, stateEntry, uiFake } from "../utils/fixtures.ts"
import { decodedState } from "./decode.ts"
import { restoreMode } from "./entry.ts"

// index.ts's wiring: decode at the boundary, restore from the typed result
const restoreFromEntries = (entries: SessionEntry[]): Mode => restoreMode(decodedState(entries))

test("returns default when no state entry exists", () => {
  assert.ok(restoreFromEntries([]).isDefault())
  assert.ok(
    restoreFromEntries([{ type: "custom", customType: "plan-mode", ...entryBase }]).isDefault(),
  )
})

test("restores a planning state in approval with its plan", () => {
  const mode = restoreFromEntries(
    stateEntry({ mode: "planning", plan: PLAN, toolsBeforePlanMode: ["read"] }),
  )
  assert.ok(mode.isPlanning())
  assert.equal(mode.plan, PLAN)
  assert.deepEqual(mode.toolsBeforePlanMode, ["read"])
})

test("restores an explore planning state without a plan", () => {
  const mode = restoreFromEntries(stateEntry({ mode: "planning" }))
  assert.ok(mode.isPlanning())
  assert.equal(mode.plan, undefined)
})

test("restores a default state with its tool snapshot", () => {
  const mode = restoreFromEntries(stateEntry({ mode: "default", toolsBeforePlanMode: ["read"] }))
  assert.ok(mode.isDefault())
  assert.deepEqual(mode.toolsBeforePlanMode, ["read"])
})

test("ignores plan_complete toolResults after the state entry", () => {
  // Recovery from toolResults is gone: the persisted plan field is the only source
  const mode = restoreFromEntries(
    stateEntry(
      { mode: "planning" },
      planCompleteResult({ version: 1, source: "plan_complete", plan: PLAN }),
    ),
  )
  assert.ok(mode.isPlanning())
  assert.equal((mode as PlanningMode).plan, undefined)
})

test("persisted plans are kept without re-validation", () => {
  // The plan was validated before it was persisted; a JSON round-trip cannot
  // invalidate a string
  assert.equal(
    (restoreFromEntries(stateEntry({ mode: "planning", plan: "just prose" })) as PlanningMode).plan,
    "just prose",
  )
})

test("default state ignores a persisted planning plan", () => {
  assert.ok(restoreFromEntries(stateEntry({ mode: "default", plan: "## 1. Stale" })).isDefault())
  assert.ok(restoreFromEntries(stateEntry({ enabled: false, plan: "## 1. Stale" })).isDefault())
})

test("ignores toolResults from other tools", () => {
  const bashResult: SessionEntry = {
    type: "message",
    ...entryBase,
    message: {
      role: "toolResult",
      toolCallId: "tc0",
      toolName: "bash",
      content: [],
      isError: false,
      timestamp: 0,
      details: { version: 1, source: "plan_complete", plan: PLAN },
    },
  }
  const mode = restoreFromEntries(stateEntry({ mode: "planning" }, bashResult))
  assert.ok(mode.isPlanning())
  assert.equal((mode as PlanningMode).plan, undefined)
})

test("the legacy enabled shape no longer migrates to planning", () => {
  const mode = restoreFromEntries(
    stateEntry({ enabled: true, plan: PLAN, toolsBeforePlanMode: ["read"] }),
  )
  assert.ok(mode.isDefault())
  assert.deepEqual(mode.toolsBeforePlanMode, ["read"])
})

test("toState round-trips through restoreMode", () => {
  const planning = new PlanningMode()
  planning.plan = PLAN
  planning.toolsBeforePlanMode = ["read"]
  assert.deepEqual(restoreFromEntries(stateEntry(planning.toState())).toState(), planning.toState())

  const handoff = new DefaultMode(["read"])
  assert.deepEqual(restoreFromEntries(stateEntry(handoff.toState())).toState(), handoff.toState())
})

test("approval menu: exit asks the caller to leave, persisting nothing itself", async () => {
  const { ctx } = uiFake({ choice: "Exit plan mode (plan stays in context)" })
  assert.equal(await promptPlanApproval(ctx, undefined, PLAN), true)
})

test("approval menu: stay keeps planning and opens nothing", async () => {
  const { ctx, editors, notifies } = uiFake({ choice: "Stay in plan mode" })
  assert.equal(await promptPlanApproval(ctx, undefined, PLAN), false)
  assert.deepEqual(editors, [])
  assert.deepEqual(notifies, ["/plan will prompt the approval."])
})

test("approval menu: Esc is a plain stay", async () => {
  const { ctx, notifies } = uiFake()
  assert.equal(await promptPlanApproval(ctx, undefined, PLAN), false)
  assert.deepEqual(notifies, [])
})

test("approval menu: fresh without a command context prefills /plan exec", async () => {
  const { ctx, editorTexts } = uiFake({ choice: "Execute in fresh session" })
  assert.equal(await promptPlanApproval(ctx, undefined, PLAN), false)
  assert.deepEqual(editorTexts, ["/plan exec"])
})

test("promptPlanApproval swallows stale-context errors and rethrows others", async () => {
  const { ctx } = uiFake()
  let thrown: Error | undefined
  const select = ctx.ui.select.bind(ctx.ui)
  ;(ctx.ui as { select: unknown }).select = async (): Promise<string | undefined> => {
    if (thrown) throw thrown
    return await select("", [])
  }

  thrown = new Error(
    "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx.",
  )
  assert.equal(await promptPlanApproval(ctx, undefined, PLAN), false)

  thrown = new Error("boom")
  await assert.rejects(promptPlanApproval(ctx, undefined, PLAN), /boom/u)
})
