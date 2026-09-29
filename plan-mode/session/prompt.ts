/**
 * The system-prompt section carrying the active mode's reminder: index.ts's
 * before_agent_start handler mutates systemPromptOptions.sections, and pi
 * appends one small persisted system message per section change
 * ("Updated system prompt section 'plan-mode'", agent-session.js
 * _preparePromptAndToolLoadout) instead of rewriting the head prompt. Later
 * requests replay that message byte-identically, so the provider cache
 * breakpoint only ever sees appends, never changed bytes. pi carries the
 * mutated options across runs too (agent-session.js _runSystemPromptOptions),
 * so once set the section survives without the extension re-setting it.
 *
 * Reminder placements, newest first:
 * - opencode's experimental plan mode persists its reminder into the last
 *   user message every turn (sessions.updatePart): cache-stable, but the
 *   transcript grows one reminder per turn
 * - opencode's legacy path - and this repo, d4f44cd..ca4e334 - appended it
 *   request-locally to the tail: providers place the cache breakpoint on
 *   the last message (pi-ai: its very last block, anthropic-messages.js /
 *   openai-completions.js; opencode: its last two non-system messages,
 *   provider/transform.ts), so request N writes the transient reminder into
 *   the cache while request N+1 re-sends that message without it - the
 *   histories diverge at the old tail and the message history never hits
 *   cache, re-billed at full input price every request
 * - this section: the entry-only variant - one appended message when
 *   planning begins, no per-turn growth, and an exit that changes nothing;
 *   the price is the read-only instructions lingering for the session,
 *   lifted by planModeEndedPrompt's one-time message instead
 *
 * https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/reminders.ts
 * https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/provider/transform.ts
 */

export const PLAN_MODE_SECTION = "plan-mode"

export function safeSetSection(prompt: string, sections: Record<string, string>): void {
  // An exit deliberately leaves the section in place: deleting it diffs into
  // an appended mid-conversation "Removed system prompt section" system
  // message (pi-ai utils/text.js renderSystemMessageUpdate), which broke the
  // provider cache when switching back to normal mode
  if (prompt === "") return
  if (sections[PLAN_MODE_SECTION] !== prompt) sections[PLAN_MODE_SECTION] = prompt
}
