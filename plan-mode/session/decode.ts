/**
 * The persisted-session boundary and the only home of `unknown`: narrows pi's
 * custom entry data into typed shapes, simplifying type handling downstream.
 * Also the home of toolResultText.
 */

import type { AgentToolResult, SessionEntry } from "@earendil-works/pi-coding-agent"
import { PLAN_COMPLETE_TOOL_NAME } from "../tools/names.ts"
import { type ModeEntry, type ModelInfo, getEntry } from "./entry.ts"

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const

// The newest plan-mode entry, narrowed; undefined when none persists. Every
// declared ModeEntry field gets an explicit narrow and unknown fields are
// ignored, so future persisted shapes still restore.
export function decodedMode(entries: SessionEntry[]): ModeEntry | undefined {
  const entry = getEntry(entries)
  if (entry?.type !== "custom" || !isRecord(entry.data)) return undefined
  return {
    mode: entry.data.mode === "planning" ? "planning" : "default",
    plan: typeof entry.data.plan === "string" ? entry.data.plan : undefined,
    modelInfo: decodeModelInfo(entry.data.modelInfo),
  }
}

function decodeModelInfo(value: unknown): ModelInfo | undefined {
  if (!isRecord(value) || !isRecord(value.model)) return undefined
  if (typeof value.model.provider !== "string" || typeof value.model.id !== "string") {
    return undefined
  }
  return {
    model: { provider: value.model.provider, id: value.model.id },
    thinkingLevel: THINKING_LEVELS.find((level) => level === value.thinkingLevel),
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

// The agent_settled gate: plan_complete returns terminate: true, so when the
// run settles right after the call, that result is the branch's newest
// message - any later turn (a question, more exploring) appends messages past
// it. Non-message entries (usage, custom, labels) are bookkeeping that never
// speaks for the run.
export function endedOnPlanCompletion(entries: SessionEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type !== "message") continue
    const { message } = entry
    return message.role === "toolResult" && message.toolName === PLAN_COMPLETE_TOOL_NAME
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
