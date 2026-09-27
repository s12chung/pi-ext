/**
 * The run-time system-prompt section carrying the active mode's prompt:
 * index.ts hands the before_agent_start event's mutable sections and the
 * mode's prompt here, and pi diffs the section in on the first planning run
 * and out on the next default run. Writes are guarded so re-applying an
 * unchanged prompt stays a no-op.
 */

export const PLAN_MODE_SECTION = "plan-mode"

export function safeSetSection(prompt: string, sections: Record<string, string>): void {
  if (prompt === "") {
    delete sections[PLAN_MODE_SECTION]
    return
  }
  if (sections[PLAN_MODE_SECTION] !== prompt) sections[PLAN_MODE_SECTION] = prompt
}
