/**
 * The persisted-session boundary and the only home of `unknown`: pi types
 * custom entry data as unknown because it round-trips through JSON on disk,
 * so this module narrows it back into the ModeEntry that toState wrote.
 * Structural checks only - plan content was validated at write time
 * (validatePlan), and a JSON round-trip cannot invalidate a string. Also the
 * home of toolResultText, the shared reading of a tool result's text.
 */

import type { AgentToolResult, SessionEntry } from "@earendil-works/pi-coding-agent"
import { type ModeEntry, PLAN_MODE_ENTRY_TYPE } from "./entry.ts"

// The newest plan-mode state entry, narrowed; undefined when none persists
export function decodedState(entries: SessionEntry[]): ModeEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === "custom" && entry.customType === PLAN_MODE_ENTRY_TYPE) {
      return decodeStateData(entry.data)
    }
  }
  return undefined
}

// Every declared ModeEntry field gets an explicit narrow; unknown fields are
// ignored so future persisted shapes still restore.
function decodeStateData(data: unknown): ModeEntry | undefined {
  if (!isRecord(data)) return undefined
  return {
    mode: data.mode === "planning" ? "planning" : "default",
    plan: typeof data.plan === "string" ? data.plan : undefined,
  }
}

// Source (adapted: planModeCompletionMarkdown → toolResultText, generic over any
// result's content rather than a plan completion's):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
// Deviates from the source: no planFromCompletionDetails fallback - pi always hands
// renderResult a populated content (AgentToolResult.content is required; thrown errors become
// text results).
// The joined text of a tool result's text content blocks, trimmed - the
// renderable transcript of the result
export function toolResultText<T>(result: AgentToolResult<T>): string {
  return result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
