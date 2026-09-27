import assert from "node:assert/strict"
import { test } from "node:test"
import { ApprovePhase, ExplorePhase, isApprovePhase } from "./phases.ts"

const PLAN =
  "## 1. Core\nSwap the field.\n\n## 2. Rendering\nHook up the consumer.\n\n## 3. Verification\nmake test."

test("submitPlan advances explore → approval with the plan", () => {
  const approval = new ExplorePhase().submitPlan(PLAN)
  assert.ok(isApprovePhase(approval))
  assert.equal(approval.plan, PLAN)
})

test("a refined plan re-enters approval", () => {
  const refined = new ApprovePhase(PLAN).submitPlan(
    "## 1. Reworked\nDifferent.\n\n## 2. Verify\nTest.",
  )
  assert.ok(isApprovePhase(refined))
  assert.equal(refined.plan, "## 1. Reworked\nDifferent.\n\n## 2. Verify\nTest.")
})
