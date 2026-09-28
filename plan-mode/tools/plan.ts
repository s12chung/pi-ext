/**
 * The plan format contract: what a submitted plan must look like, stated to
 * the model (PLAN_FORMAT_DESCRIPTION, quoted by the plan_complete tool
 * description) and enforced by the validator the plan_complete tool call
 * passes through.
 */

// The plan format as the model sees it in the tool description. Free-flow
// plan format (numbered markdown headings + verification) adapted from
// opencode's plan-mode prompt (Phase 4); the count cap and
// broad-strokes-only rule are local:
// https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt/plan-mode.txt
export const PLAN_FORMAT_DESCRIPTION =
  'The decision-ready plan as free-flow markdown: numbered phase headings ("## 1. Short title"), each followed by its description. Include the paths of critical files to be modified; each phase includes how to verify its changes.'

// Stated only in validation errors, never in the prompt - a mentioned count
// anchors the model into padding the plan to exactly that many phases
const PLAN_MAX_PHASES = 10

// A phase heading line: a markdown heading of any level, numbered, with a
// non-empty title ("## 1. Title") - only the number is captured
const PHASE_HEADING_PATTERN = /^#{1,6}\s+(\d+)[.)]\s+.+$/u

// Throws a format error the model can correct the plan from and resubmit;
// the caller keeps its own trimmed copy
export function validatePlan(input: string): void {
  const plan = input.trim()
  if (!plan) throw new Error("plan must be a non-empty string")

  const headingNumbers = plan.split("\n").flatMap((line) => {
    const match = PHASE_HEADING_PATTERN.exec(line.trim())
    return match ? [Number(match[1])] : []
  })
  if (headingNumbers.length === 0) {
    throw new Error('plan must contain numbered markdown phase headings, e.g. "## 1. Title"')
  }
  if (headingNumbers.length > PLAN_MAX_PHASES) {
    throw new Error(`plan must not exceed ${PLAN_MAX_PHASES} phase headings`)
  }
  const brokenAt = headingNumbers.findIndex((number, i) => number !== i + 1)
  if (brokenAt !== -1) {
    throw new Error(
      `phase headings must be numbered 1..${headingNumbers.length} in order (heading ${brokenAt + 1} is numbered ${headingNumbers[brokenAt]})`,
    )
  }
}
