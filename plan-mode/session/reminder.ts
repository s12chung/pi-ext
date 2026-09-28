/**
 * The request-local mode reminders: pi hands each `context` handler a clone of
 * the transcript before every LLM call and restores the real one afterwards,
 * so a reminder appended here rides the request without persisting or
 * accumulating.
 */

import type {
  ImageContent,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai"
import type { ContextEvent } from "@earendil-works/pi-coding-agent"
import type { Mode } from "../mode.ts"

type Messages = ContextEvent["messages"]

// opencode placement: appending to the tail message keeps the cached prefix
// intact while still riding every request - at request time the tail is always
// user-role and uncached (fresh user text or tool results). Prompt content
// adapted from opencode's plan-mode.txt / plan.txt.
// https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt/plan-mode.txt
export const PLAN_MODE_PROMPT = `[PLAN MODE ACTIVE]
The user indicated that they do not want you to execute yet -- you MUST NOT
make any edits, run any non-readonly tools (including changing configs or
making commits), or otherwise make any changes to the system. This supersedes
any other instructions you have received. The ONLY exception: experiments
may mutate, but ONLY inside a temporary folder (e.g. under /tmp) - never the
workspace, and never as part of doing the planned work.

1. Focus on understanding the user's request and the code associated with their request
2. Use the questionnaire tool to clarify ambiguities in the user request up
   front, and ask for their opinion when weighing tradeoffs - don't make
   large assumptions about user intent

Plan format - free-flow markdown, concise enough to scan quickly, but
detailed enough to execute effectively:
- Include only your recommended approach, not all alternatives
- Break the work into one or more phases, each opened by a numbered markdown
  heading ("## 1. Short title", numbered sequentially from 1) followed by
  its description
- A phase is a fully completed, decoupled unit of work - it delivers
  something that works on its own, with no loose ends that only a later
  phase ties off
- Include the paths of critical files to be modified
- Each phase includes how to verify its changes end-to-end (run the
  code, run tests)

At the very end of your turn, once you have asked the user questions and
are happy with your final plan, call the plan_complete tool alone, passing the
whole plan markdown as its plan argument. This is critical - your turn should
only end with either asking the user a question or calling plan_complete. Do
not stop unless it's for these 2 reasons. Do NOT use the questionnaire tool
to ask "Is this plan okay?" - that's what plan_complete does.`

// Appended to default requests right after a planning exit (until the next
// session start): lifts the read-only constraint for a model that can still
// see plan instructions in the transcript.
export const PLAN_MODE_ENDED_PROMPT = `[PLAN MODE ENDED]
Plan mode is over - edit and write are available again. You may now make
changes, including executing the plan produced earlier in this conversation.`

// Append the active mode's reminder to the newest user message: planning rides
// the plan-mode prompt, the requests after an exit ride the switch note, and
// plain default rides nothing.
export function applyReminders(
  mode: Mode,
  justExitedPlan: boolean,
  messages: Messages,
): Messages | undefined {
  let reminder: string | undefined
  if (mode.isPlanning()) reminder = PLAN_MODE_PROMPT
  else if (justExitedPlan) reminder = PLAN_MODE_ENDED_PROMPT

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
