import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent"
import { DefaultMode, type Mode, PlanningMode } from "../mode.ts"
import { PLAN, entryBase, planCompleteResult, stateEntry, userEntry } from "../utils/fixtures.ts"
import { decodeSession } from "./decode.ts"
import { promptPlanApproval, restoreMode, setMode } from "./state.ts"

// index.ts's wiring: decode at the boundary, restore from the typed result
const restoreFromEntries = (entries: SessionEntry[]): Mode => restoreMode(decodeSession(entries))

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

test("recovers the plan from a plan_complete toolResult after the state entry", () => {
  const mode = restoreFromEntries(
    stateEntry(
      { mode: "planning" },
      planCompleteResult({ version: 1, source: "plan_complete", plan: PLAN }),
    ),
  )
  assert.ok(mode.isPlanning())
  assert.equal(mode.plan, PLAN)
})

test("ignores plan_complete toolResults before the state entry", () => {
  const mode = restoreFromEntries([
    planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. Old" }),
    ...stateEntry({ mode: "planning" }),
  ])
  assert.ok(mode.isPlanning())
  assert.equal(mode.plan, undefined)
})

test("newest plan_complete toolResult wins", () => {
  const entries = stateEntry(
    { mode: "planning" },
    planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. First" }),
    userEntry,
    planCompleteResult({ version: 1, source: "plan_complete", plan: "## 1. Second" }),
  )
  assert.equal((restoreFromEntries(entries) as PlanningMode).plan, "## 1. Second")
})

test("invalid persisted plan falls back to toolResult recovery", () => {
  const entries = stateEntry(
    { mode: "planning", plan: "  " },
    planCompleteResult({ version: 1, source: "plan_complete", plan: PLAN }),
  )
  assert.equal((restoreFromEntries(entries) as PlanningMode).plan, PLAN)
})

test("persisted plan without phase headings is ignored", () => {
  const mode = restoreFromEntries(stateEntry({ mode: "planning", plan: "just prose" }))
  assert.ok(mode.isPlanning())
  assert.equal(mode.plan, undefined)
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
  assert.equal(
    restoreFromEntries(stateEntry({ mode: "planning" }, bashResult)).shouldPromptApproval(),
    false,
  )
})

test("migrates the pre-mode-objects enabled shape", () => {
  const planning = restoreFromEntries(
    stateEntry({ enabled: true, plan: PLAN, toolsBeforePlanMode: ["read"] }),
  )
  assert.ok(planning.isPlanning())
  assert.equal(planning.plan, PLAN)
  assert.deepEqual(planning.toolsBeforePlanMode, ["read"])

  const handoff = restoreFromEntries(stateEntry({ enabled: false, toolsBeforePlanMode: ["read"] }))
  assert.ok(handoff.isDefault())
  assert.deepEqual(handoff.toolsBeforePlanMode, ["read"])
})

test("toState round-trips through restoreMode", () => {
  const planning = new PlanningMode()
  planning.plan = PLAN
  planning.toolsBeforePlanMode = ["read"]
  assert.deepEqual(restoreFromEntries(stateEntry(planning.toState())).toState(), planning.toState())

  const handoff = new DefaultMode(["read"])
  assert.deepEqual(restoreFromEntries(stateEntry(handoff.toState())).toState(), handoff.toState())
})

function planningWithPlan(): PlanningMode {
  const planning = new PlanningMode()
  planning.plan = PLAN
  return planning
}

// Fakes covering what mode enter()/promptPlanApproval touch; hasUI stays off
// so ensureBorderTint skips the editor wrap
interface ApprovalFixture {
  pi: ExtensionAPI
  ctx: ExtensionContext
  mode: Mode
  entries: unknown[]
  sent: Array<Record<string, unknown>>
  editorTexts: string[]
}

function approvalFixture(
  choice: string | undefined,
  options?: { editor?: () => Promise<string | undefined> },
): ApprovalFixture {
  const entries: unknown[] = []
  const sent: Array<Record<string, unknown>> = []
  const editorTexts: string[] = []
  const mode: Mode = planningWithPlan()
  const pi = {
    getActiveTools: () => ["read", "bash", "edit", "write"],
    setActiveTools: () => {},
    appendEntry: (_customType: string, data: unknown) => entries.push(data),
    sendMessage: (message: Record<string, unknown>) => sent.push(message),
    sendUserMessage: (text: string) => sent.push({ customType: "user", content: text }),
  } as unknown as ExtensionAPI
  const ctx = {
    hasUI: false,
    ui: {
      select: (): Promise<string | undefined> => Promise.resolve(choice),
      editor: options?.editor ?? ((): Promise<string | undefined> => Promise.resolve(undefined)),
      notify: () => {},
      setStatus: () => {},
      setEditorText: (text: string) => editorTexts.push(text),
      theme: { fg: (_role: string, text: string) => text },
    },
  } as unknown as ExtensionContext
  return { pi, ctx, mode, entries, sent, editorTexts }
}

test("setMode enters, persists, and returns the successor", () => {
  const { pi, ctx, mode, entries } = approvalFixture(undefined)
  ;(mode as PlanningMode).toolsBeforePlanMode = ["read"]
  const next = setMode(pi, ctx, mode.next())
  assert.ok(next.isDefault())
  assert.deepEqual(entries, [{ mode: "default", toolsBeforePlanMode: ["read"] }])
})

test("approval menu: stay opens the refinement editor, empty keeps planning", async () => {
  const { pi, ctx, mode, entries, sent } = approvalFixture("Stay and refine the plan")
  const result = await promptPlanApproval(pi, ctx, undefined, mode)
  assert.ok(result.isPlanning())
  assert.deepEqual(entries, [])
  assert.deepEqual(sent, [])
})

test("approval menu: exit returns the swapped-in default and persists", async () => {
  const { pi, ctx, mode, entries } = approvalFixture("Exit plan mode (plan stays in context)")
  const next = await promptPlanApproval(pi, ctx, undefined, mode)
  assert.ok(next.isDefault())
  assert.equal(entries.length, 1)
  assert.equal((entries[0] as { mode: string }).mode, "default")
})

test("approval menu: stay sends the refinement as a follow-up", async () => {
  const { pi, ctx, mode, sent } = approvalFixture("Stay and refine the plan", {
    editor: () => Promise.resolve("make it faster"),
  })
  const result = await promptPlanApproval(pi, ctx, undefined, mode)
  assert.ok(result.isPlanning())
  assert.deepEqual(sent, [{ customType: "user", content: "make it faster" }])
})

test("approval menu: fresh without a command context restages the plan and prefills /plan exec", async () => {
  const { pi, ctx, mode, entries, editorTexts } = approvalFixture("Execute in fresh session")
  const result = await promptPlanApproval(pi, ctx, undefined, mode)
  assert.ok(result.isPlanning())
  // The restage keeps the menu owed until the prefilled /plan exec runs
  assert.equal(result.plan, PLAN)
  assert.deepEqual(editorTexts, ["/plan exec"])
  assert.deepEqual(entries, [])
})

test("approval menu: without a plan it never opens", async () => {
  const { pi, ctx, sent } = approvalFixture("Exit plan mode (plan stays in context)")
  const exploring = new PlanningMode()
  const result = await promptPlanApproval(pi, ctx, undefined, exploring)
  assert.equal(result, exploring)
  assert.deepEqual(sent, [])
})

test("promptPlanApproval swallows stale-context errors and rethrows others", async () => {
  const { pi, ctx, mode, entries } = approvalFixture(undefined)
  let thrown: Error | undefined
  const select = ctx.ui.select.bind(ctx.ui)
  ;(ctx.ui as { select: unknown }).select = async (): Promise<string | undefined> => {
    if (thrown) throw thrown
    return await select("", [])
  }

  thrown = new Error(
    "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx.",
  )
  const result = await promptPlanApproval(pi, ctx, undefined, mode)
  assert.ok(result.isPlanning())
  assert.deepEqual(entries, [])

  thrown = new Error("boom")
  await assert.rejects(promptPlanApproval(pi, ctx, undefined, planningWithPlan()), /boom/u)
})
