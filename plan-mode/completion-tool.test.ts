import assert from "node:assert/strict"
import { test } from "node:test"
import {
  ApprovePhase,
  ExplorePhase,
  isApprovePhase,
  normalizePlanCompletion,
  planCompleted,
  planCompletionMarkdown,
} from "./completion-tool.ts"

const PLAN =
  "## 1. Core\nSwap the field.\n\n## 2. Rendering\nHook up the consumer.\n\n## 3. Verification\nmake test."
const FORMAT_HELP =
  'Expected: numbered markdown phase headings ("## 1. Short title"), numbered sequentially from 1, each followed by its description.'

test("normalizePlanCompletion trims surrounding whitespace", () => {
  assert.deepEqual(normalizePlanCompletion(`\n${PLAN}\n`), { ok: true, plan: PLAN })
})

test("normalizePlanCompletion accepts any heading level and 1) numbering", () => {
  assert.equal(normalizePlanCompletion("# 1. A\n### 2) B").ok, true)
})

test("normalizePlanCompletion rejects an empty plan", () => {
  assert.deepEqual(normalizePlanCompletion("  "), {
    ok: false,
    error: `plan must be a non-empty string. ${FORMAT_HELP}`,
  })
})

test("normalizePlanCompletion rejects a plan without phase headings", () => {
  assert.deepEqual(normalizePlanCompletion("Just prose, no headings."), {
    ok: false,
    error: `plan must contain numbered markdown phase headings, e.g. "## 1. Title". ${FORMAT_HELP}`,
  })
})

test("normalizePlanCompletion enforces the phase-count limit", () => {
  assert.equal(
    normalizePlanCompletion(
      Array.from({ length: 10 }, (_, i) => `## ${i + 1}. P${i + 1}`).join("\n"),
    ).ok,
    true,
  )
  assert.equal(
    normalizePlanCompletion(
      Array.from({ length: 11 }, (_, i) => `## ${i + 1}. P${i + 1}`).join("\n"),
    ).ok,
    false,
  )
})

test("normalizePlanCompletion rejects out-of-order numbering", () => {
  assert.deepEqual(normalizePlanCompletion("## 2. First\n## 3. Second"), {
    ok: false,
    error: `phase headings must be numbered 1..2 in order (heading 1 is numbered 2). ${FORMAT_HELP}`,
  })
  assert.equal(normalizePlanCompletion("## 1. A\n## 3. B").ok, false)
})

test("planCompleted terminates the turn and carries the details payload", () => {
  const result = planCompleted(PLAN)
  assert.equal(result.terminate, true)
  assert.deepEqual(result.content, [{ type: "text", text: `**Proposed Plan**\n\n${PLAN}` }])
  assert.deepEqual(result.details, { version: 1, source: "plan_complete", plan: PLAN })
})

test("planCompletionMarkdown renders the result content", () => {
  const result = planCompleted(PLAN)
  assert.equal(
    planCompletionMarkdown({ content: result.content, details: undefined }),
    `**Proposed Plan**\n\n${PLAN}`,
  )
})

test("planCompletionMarkdown returns empty without text content", () => {
  assert.equal(planCompletionMarkdown({ content: [], details: undefined }), "")
  assert.equal(
    planCompletionMarkdown({ content: [], details: { version: 2, source: "plan_complete" } }),
    "",
  )
})

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
