/**
 * The extension's model-facing prompts: the two mode reminders, the tool
 * descriptions, and the /plan command description. `<agent-dir>/plan-mode.json`
 * overlays its string values onto the built-ins - the file missing is silent
 * defaults, anything malformed or invalid keeps the defaults and reports a
 * warning the extension notifies once.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { safeErrorDetail } from "./utils/safe.ts"

// The keys plan-mode.json may set; all optional, all non-empty strings
export interface PlanPrompts {
  planModePrompt: string
  planModeEndedPrompt: string
  planModeReenteredPrompt: string
  planCompleteDescription: string
  planFormatDescription: string
  questionnaireDescription: string
  planCommandDescription: string
}

// Built-ins. Prompt content adapted from opencode's plan-mode.txt / plan.txt;
// the plan_complete description from its plan-exit.txt (call/avoid bullets →
// prose; its plan-file wording is dropped since the plan is the tool call
// itself); the plan format from its plan-mode prompt (Phase 4).
// https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt/plan-mode.txt
// https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/plan-exit.txt
export const DEFAULT_PROMPTS: PlanPrompts = {
  planModePrompt: `[PLAN MODE ACTIVE]
The user indicated that they do not want you to execute yet -- you MUST NOT
make any edits, run any non-readonly tools (including changing configs or
making commits), or otherwise make any changes to the system. This supersedes
any other instructions you have received. The ONLY exception: experiments
may mutate, but ONLY inside a temporary folder (e.g. /tmp).

1. Focus on understanding the user's request and the code related to their request
2. Draw a SIMPLIFIED HIGH LEVEL sketch of the plan
3. Use the questionnaire tool to clarify ambiguities in the user request up
   front, and ask for their opinion when weighing tradeoffs -
   INITIALLY assume minimal code/scope, even removing code, but
   ALWAYS ASK TO CONFIRM

Plan format - free-flow markdown:
- Break the work into one or more phases, each opened by a numbered markdown
  heading ("## 1. Short title", numbered sequentially from 1) followed by
  its description
- A phase MUST be a fully completed, decoupled unit of work - it delivers
  something that works on its own with no loose ends -- tests,
  verification, cleanup/removal, and doc updates INCLUDED
- Mention loose ends with NO SPECIFICS OR NAMES, unless there are rare
  **Notes** (see below)
- Freely add sections to each phase

Plan content:
- Include only your recommended approach, no alternatives
- All content must fit these shapes, but FREEFORM this content:
  1. **Sketch** -- high level intent sketch
  2. **Spec** -- a change to or definition of
     classes/interfaces/libraries (rarely a function, never a file)
     to achieve a desired intent (focus on INTENT)
  3. **Inspirations** -- optional references to code to follow patterns from
  4. **Notes** -- optional specifics that CANNOT BE DERIVED by
     attempting to implement the plan, usually external to the codebase
- The best specifics are pointers to code or documentation with
  less than 10 words
- Write CONCRETE EXAMPLES -- user-facing interfaces, declarative
  code, lifecycle examples listing steps, or summary pseudocode

MOST OF THE CONTENT must be HIGH LEVEL intent-focused changes,
NEVER BY FILE/FUNCTION.

At the very end of your turn, once you have asked the user questions and
are happy with your final plan, call the plan_complete tool alone, passing the
whole plan markdown as its plan argument. This is critical - your turn should
only end with either asking the user a question or calling plan_complete. Do
not stop unless it's for these 2 reasons. Do NOT use the questionnaire tool
to ask "Is this plan okay?" - that's what plan_complete does.`,

  planModeEndedPrompt: `[PLAN MODE ENDED]
Plan mode is over - edit and write are available again. You may now make
changes, including executing the plan produced earlier in this conversation.`,

  planModeReenteredPrompt: `[PLAN MODE RE-ENTERED]
Plan mode is active again - the [PLAN MODE ACTIVE] constraints reapply: no
edits, no non-readonly tools, no changes to the system, except experiments
inside a temporary folder. End your turn with a question or a plan_complete
call.`,

  planCompleteDescription:
    "Always available, but call it ONLY while plan mode is active. Only in plan mode, call this tool: after you have written a complete plan, after you have clarified any questions with the user, when you are confident that the plan is ready for implementation. Do NOT call this tool: before you have finalized the plan, if you still have unanswered questions about the implementation, if the user has indicated that they want to continue planning.",

  planFormatDescription:
    'The decision-ready plan as free-flow markdown: numbered phase headings ("## 1. Short title"), each followed by its description. Include the paths of critical files to be modified; each phase includes how to verify its changes.',

  questionnaireDescription:
    "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.",

  planCommandDescription:
    "Toggle plan mode (read-only exploration); /plan exec starts a fresh implementation session",
}

// pi's agent dir: PI_CODING_AGENT_DIR wins, ~/.pi/agent is the fallback
export function resolveAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")
}

// hasOwn, not `in`: prototype-inherited names (toString, constructor, ...) are
// not config keys
const isPromptKey = (key: string): key is keyof PlanPrompts => Object.hasOwn(DEFAULT_PROMPTS, key)

// Sync read of the overlay
export function loadPrompts(agentDir: string = resolveAgentDir()): {
  prompts: PlanPrompts
  warning?: string
} {
  const path = join(agentDir, "plan-mode.json")

  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { prompts: DEFAULT_PROMPTS }
    return {
      prompts: DEFAULT_PROMPTS,
      warning: `${path}: ${safeErrorDetail(error)} - using default prompts`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      prompts: DEFAULT_PROMPTS,
      warning: `${path}: ${safeErrorDetail(error)} - using default prompts`,
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      prompts: DEFAULT_PROMPTS,
      warning: `${path}: expected a JSON object - using default prompts`,
    }
  }

  const prompts: PlanPrompts = { ...DEFAULT_PROMPTS }
  const ignored: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (isPromptKey(key) && typeof value === "string" && value.trim()) prompts[key] = value
    else ignored.push(`${key} (${isPromptKey(key) ? "not a non-empty string" : "unknown key"})`)
  }
  const warning =
    ignored.length > 0 ? `${path}: ignored ${ignored.join(", ")} - defaults apply` : undefined
  return { prompts, warning }
}

// The prompts every consumer imports, no threading: seeded with the built-ins
// at module load, overwritten by the extension factory with the overlay - so
// /reload, which re-runs the factory, picks up config edits
export const PROMPTS: PlanPrompts = { ...DEFAULT_PROMPTS }
