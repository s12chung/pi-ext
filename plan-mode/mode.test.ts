import assert from "node:assert/strict"
import { test } from "node:test"
import { DefaultMode, type Mode, PlanningMode } from "./mode.ts"
import { PLAN } from "./utils/fixtures.ts"

test("toggle round-trips and carries the tool snapshot to default", () => {
  const planning = new DefaultMode().next()
  assert.ok(planning.isPlanning())
  assert.equal(planning.plan, undefined)

  planning.toolsBeforePlanMode = ["read", "bash"]
  const back = planning.next()
  assert.ok(back.isDefault())
  assert.deepEqual(back.toolsBeforePlanMode, ["read", "bash"])
  assert.equal(back.activePlan, undefined)
})

test("DefaultMode hands its activePlan to a fresh planning mode's discard", () => {
  const handoff = new DefaultMode(PLAN)
  const planning = handoff.next()
  assert.ok(planning.isPlanning())
  assert.equal(planning.plan, undefined)
})

test("completePlan validates before staging the plan", () => {
  const planning = new PlanningMode()
  assert.throws(() => planning.completePlan({ plan: "just prose" }), /phase headings/u)
  assert.equal(planning.plan, undefined)

  planning.completePlan({ plan: PLAN })
  assert.equal(planning.plan, PLAN)
  assert.equal(planning.shouldPromptApproval(), true)
})

test("shouldPromptApproval only while a plan is staged", () => {
  const planning = new PlanningMode()
  assert.equal(planning.shouldPromptApproval(), false)

  planning.completePlan({ plan: PLAN })
  assert.equal(planning.shouldPromptApproval(), true)

  // Opening the menu consumes the staged plan: rejection rests in explore
  planning.rejectApproval()
  assert.equal(planning.shouldPromptApproval(), false)
  assert.equal(planning.plan, undefined)

  // A refined plan restages and re-enters approval
  planning.completePlan({ plan: "## 1. Reworked\nDifferent.\n\n## 2. Verify\nTest." })
  assert.equal(planning.plan, "## 1. Reworked\nDifferent.\n\n## 2. Verify\nTest.")
  assert.equal(planning.shouldPromptApproval(), true)
})

test("DefaultMode refuses plan_complete and stays permissive", () => {
  const mode: Mode = new DefaultMode()
  assert.throws(
    () => mode.completePlan({ plan: PLAN }),
    /only available while plan mode is active/u,
  )
  assert.equal(mode.systemPrompt(), "")
  assert.equal(mode.shouldPromptApproval(), false)
})

test("PlanningMode returns the plan-mode prompt with the read-only constraint", () => {
  const content = new PlanningMode().systemPrompt()
  assert.match(content, /\[PLAN MODE ACTIVE\]/u)
  assert.match(content, /MUST NOT/u)
  assert.match(content, /ONLY inside a temporary folder/u)
})

test("toState shapes carry each mode's own fields", () => {
  assert.deepEqual(new DefaultMode().toState(), {
    mode: "default",
    activePlan: undefined,
    toolsBeforePlanMode: undefined,
  })
  assert.deepEqual(new DefaultMode(PLAN, ["read"]).toState(), {
    mode: "default",
    activePlan: PLAN,
    toolsBeforePlanMode: ["read"],
  })

  const planning = new PlanningMode()
  planning.toolsBeforePlanMode = ["read"]
  assert.deepEqual(planning.toState(), {
    mode: "planning",
    plan: undefined,
    toolsBeforePlanMode: ["read"],
  })
})
