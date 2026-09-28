/**
 * The plan format contract: what a submitted plan must look like, stated to
 * the model via the plan_complete tool (the format wording lives in config.ts,
 * configurable) and enforced by the validator the plan_complete tool call
 * passes through.
 */

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
