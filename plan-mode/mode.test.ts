import assert from "node:assert/strict"
import { test } from "node:test"
import { DefaultMode, type Mode, PlanningMode } from "./mode.ts"
import { PLAN } from "./utils/fixtures.ts"

test("toggle round-trips between the modes", () => {
  const planning = new DefaultMode().next()
  assert.ok(planning.isPlanning())
  assert.equal(planning.plan, undefined)

  const back = planning.next()
  assert.ok(back.isDefault())
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
})

test("toState shapes carry each mode's own fields", () => {
  assert.deepEqual(new DefaultMode().toEntry(), { mode: "default" })

  const planning = new PlanningMode()
  assert.deepEqual(planning.toEntry(), { mode: "planning", plan: undefined })

  planning.plan = PLAN
  assert.deepEqual(planning.toEntry(), { mode: "planning", plan: PLAN })
})
