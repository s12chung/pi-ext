/**
 * The system-prompt section carrying the active mode's reminder: index.ts's
 * before_agent_start handler mutates systemPromptOptions.sections, and pi
 * appends one small persisted system message per section change
 * ("Updated/Removed system prompt section 'plan-mode'", agent-session.js
 * _preparePromptAndToolLoadout) instead of rewriting the head prompt. Entry
 * installs the section, and a re-entry's re-install patch re-sends the whole
 * prompt, so it announces itself; only the exit carries a note
 * (sendEndedNote below, opencode's BUILD_SWITCH equivalent): the bare removal
 * patch never says the model may go implement. opencode's experimental plan
 * mode instead persists its reminder into the last user message every turn -
 * cache-stable too, but the transcript grows a reminder per turn.
 *
 * https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/reminders.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { PROMPTS } from "../config.ts"

const PLAN_MODE_SECTION = "plan-mode"

export function setSection(prompt: string, sections: Record<string, string>): void {
  // Section patches are mid-conversation system messages: models with
  // supportsMidConvoSystemMessages in pi-ai's per-model catalog - the current
  // generation of four families (claude 4.8+/5.x, gpt-5.4+, kimi-k2.6+/k3,
  // deepseek-v4-pro) - get them appended in place, cache-stable; the rest
  // (e.g. zai's glm) fold them into the leading prompt and re-bill the whole
  // prefix once per toggle. Mid-conversation tool changes are rarer -
  // supportsMidConvoToolChanges/Additions, literally currently only claude
  // and kimi-k3 - so the loadout stays constant (utils/tool-set.ts).
  if (prompt === "") {
    delete sections[PLAN_MODE_SECTION]
    return
  }
  if (sections[PLAN_MODE_SECTION] !== prompt) sections[PLAN_MODE_SECTION] = prompt
}

export function sectionInstalled(sections: Record<string, string> | undefined): boolean {
  return sections !== undefined && PLAN_MODE_SECTION in sections
}

export function sendEndedNote(pi: ExtensionAPI): void {
  pi.sendMessage({
    customType: "plan-mode-ended",
    content: PROMPTS.planModeEndedPrompt,
    display: false,
  })
}
