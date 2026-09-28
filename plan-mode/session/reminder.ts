/**
 * The request-local mode reminders: pi hands each `context` handler a clone of
 * the transcript before every LLM call and restores the real one afterwards,
 * so a reminder appended here rides the request without persisting or
 * accumulating. The wording is config.ts's PROMPTS (configurable via
 * plan-mode.json).
 */

import type {
  ImageContent,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai"
import type { ContextEvent } from "@earendil-works/pi-coding-agent"
import { PROMPTS } from "../config.ts"
import type { Mode } from "../mode.ts"

type Messages = ContextEvent["messages"]

// opencode placement: appending to the tail message keeps the cached prefix
// intact while still riding every request - at request time the tail is always
// user-role and uncached (fresh user text or tool results). The active-mode
// prompt rides planning; the switch note rides the requests after a planning
// exit (until the next session start), lifting the read-only constraint for a
// model that can still see plan instructions in the transcript.
export function applyReminders(
  mode: Mode,
  justExitedPlan: boolean,
  messages: Messages,
): Messages | undefined {
  let reminder: string | undefined
  if (mode.isPlanning()) reminder = PROMPTS.planModePrompt
  else if (justExitedPlan) reminder = PROMPTS.planModeEndedPrompt

  const tail = messages.at(-1)
  if (!reminder || !tail) return undefined

  // The two request-time tails, both user-role in the provider payload;
  // appending a block to an existing message inserts nothing, so there are no
  // role-alternation concerns
  if (tail.role === "user") {
    const base =
      typeof tail.content === "string"
        ? [{ type: "text" as const, text: tail.content }]
        : tail.content
    return withReminderAppended(messages, tail, base, reminder)
  }
  if (tail.role === "toolResult") {
    return withReminderAppended(messages, tail, tail.content, reminder)
  }
  return undefined
}

// The transcript with the reminder appended to the tail message's text blocks;
// undefined when the tail already carries it (idempotent)
function withReminderAppended(
  messages: Messages,
  tail: UserMessage | ToolResultMessage,
  base: readonly (TextContent | ImageContent)[],
  reminder: string,
): Messages | undefined {
  const last = base.at(-1)
  if (last?.type === "text" && last.text === reminder) return undefined
  const content: (TextContent | ImageContent)[] = [...base, { type: "text", text: reminder }]
  return [...messages.slice(0, -1), { ...tail, content }]
}
