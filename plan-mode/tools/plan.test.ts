import assert from "node:assert/strict"
import { test } from "node:test"
import { validatePlan } from "./plan.ts"

const PLAN =
  "## 1. Core\nSwap the field.\n\n## 2. Rendering\nHook up the consumer.\n\n## 3. Verification\nmake test."

test("validatePlan trims surrounding whitespace before validating", () => {
  validatePlan(`\n${PLAN}\n`)
})

test("validatePlan accepts any heading level and 1) numbering", () => {
  validatePlan("# 1. A\n### 2) B")
})

test("validatePlan rejects an empty plan", () => {
  assert.throws(() => validatePlan("  "), /plan must be a non-empty string/u)
})

test("validatePlan rejects a plan without phase headings", () => {
  assert.throws(
    () => validatePlan("Just prose, no headings."),
    /plan must contain numbered markdown phase headings, e\.g\. "## 1\. Title"/u,
  )
})

test("validatePlan enforces the phase-count limit", () => {
  validatePlan(Array.from({ length: 10 }, (_, i) => `## ${i + 1}. P${i + 1}`).join("\n"))
  assert.throws(
    () => validatePlan(Array.from({ length: 11 }, (_, i) => `## ${i + 1}. P${i + 1}`).join("\n")),
    /plan must not exceed 10 phase headings/u,
  )
})

test("validatePlan rejects out-of-order numbering", () => {
  assert.throws(
    () => validatePlan("## 2. First\n## 3. Second"),
    /phase headings must be numbered 1\.\.2 in order \(heading 1 is numbered 2\)/u,
  )
  assert.throws(() => validatePlan("## 1. A\n## 3. B"), /in order/u)
})
