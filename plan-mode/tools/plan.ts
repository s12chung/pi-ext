/**
 * The plan format contract: what a submitted plan must look like, stated to
 * the model (PLAN_FORMAT_DESCRIPTION, quoted by the plan_complete tool
 * description) and enforced by the validator that both the tool-call params
 * and persisted plans (decode.ts) pass through.
 */

// The plan format as the model sees it in the tool description. Free-flow
// plan format (numbered markdown headings + verification) adapted from
// opencode's plan-mode prompt (Phase 4); the count cap and
// broad-strokes-only rule are local:
// https://github.com/sst/opencode/blob/main/packages/opencode/src/session/prompt/plan-mode.txt
export const PLAN_FORMAT_DESCRIPTION =
  'The decision-ready plan as free-flow markdown: numbered phase headings ("## 1. Short title"), each followed by its description. Include the paths of critical files to be modified; end with a verification phase.'

// Stated only in validation errors, never in the prompt - a mentioned count
// anchors the model into padding the plan to exactly that many phases
const PLAN_MAX_PHASES = 10

// A phase heading line: a markdown heading of any level, numbered, with a
// non-empty title ("## 1. Title") - only the number is captured
const PHASE_HEADING_PATTERN = /^#{1,6}\s+(\d+)[.)]\s+.+$/u

type NormalizePlanCompletionResult = { ok: true; plan: string } | { ok: false; error: string }

// Every rejection carries the format so the model can correct the plan from
// the tool error alone and resubmit
const PLAN_FORMAT_HELP =
  'Expected: numbered markdown phase headings ("## 1. Short title"), numbered sequentially from 1, each followed by its description.'

function invalidPlan(reason: string): NormalizePlanCompletionResult {
  return { ok: false, error: `${reason}. ${PLAN_FORMAT_HELP}` }
}

// Format validation for both callers: pi hands execute schema-validated
// params, and decode.ts narrows persisted session data before passing it in
export function normalizePlanCompletion(input: string): NormalizePlanCompletionResult {
  const plan = input.trim()
  if (!plan) {
    return invalidPlan("plan must be a non-empty string")
  }
  const headingNumbers = plan.split("\n").flatMap((line) => {
    const match = PHASE_HEADING_PATTERN.exec(line.trim())
    return match ? [Number(match[1])] : []
  })
  if (headingNumbers.length === 0) {
    return invalidPlan('plan must contain numbered markdown phase headings, e.g. "## 1. Title"')
  }
  if (headingNumbers.length > PLAN_MAX_PHASES) {
    return invalidPlan(`plan must not exceed ${PLAN_MAX_PHASES} phase headings`)
  }
  const brokenAt = headingNumbers.findIndex((number, i) => number !== i + 1)
  if (brokenAt !== -1) {
    return invalidPlan(
      `phase headings must be numbered 1..${headingNumbers.length} in order (heading ${brokenAt + 1} is numbered ${headingNumbers[brokenAt]})`,
    )
  }
  return { ok: true, plan }
}
