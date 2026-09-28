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
})

test("getPlan hands out the staged plan", () => {
  const mode: Mode = new DefaultMode()
  assert.equal(mode.getPlan(), undefined)

  const planning = new PlanningMode()
  assert.equal(planning.getPlan(), undefined)
  planning.plan = PLAN
  assert.equal(planning.getPlan(), PLAN)

  planning.plan = undefined
  assert.equal(planning.getPlan(), undefined)
})

test("DefaultMode is permissive outside planning", () => {
  const mode: Mode = new DefaultMode()
  // index.ts's completionTool callback gates plan_complete on isPlanning()
  assert.equal(mode.isPlanning(), false)
  assert.equal(mode.systemPrompt(), "")
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
    toolsBeforePlanMode: undefined,
  })
  assert.deepEqual(new DefaultMode(["read"]).toState(), {
    mode: "default",
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
