/**
 * The persisted-session boundary and the only home of `unknown`: pi types
 * custom entry data and toolResult details as unknown because they round-trip
 * through JSON on disk, so this module decodes them into the extension's
 * typed shapes. index.ts calls decodeSession and passes the result along;
 * everything downstream is fully typed. Also the home of toolResultText,
 * the shared reading of a tool result's text.
 */

import type { AgentToolResult, CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent"
import { PLAN_COMPLETE_TOOL_NAME, PLAN_COMPLETE_VERSION } from "../tools/names.ts"
import { normalizePlanCompletion } from "../tools/plan.ts"
import type { PlanModeState } from "./state.ts"

export interface DecodedSession {
  // The newest plan-mode state entry, decoded; undefined when none persists
  state?: PlanModeState
  // The plan from the newest plan_complete toolResult after the state entry
  completionPlan?: string
}

export function decodeSession(entries: SessionEntry[]): DecodedSession {
  let stateEntry: CustomEntry | undefined
  let stateEntryIndex = -1
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index]
    if (candidate?.type === "custom" && candidate.customType === "plan-mode") {
      stateEntry = candidate
      stateEntryIndex = index
      break
    }
  }
  return {
    state: stateEntry && decodeStateData(stateEntry.data),
    completionPlan: decodedPlanCompletion(entries.slice(stateEntryIndex + 1)),
  }
}

// Every declared PlanModeState field gets an explicit decoder; unknown fields
// are ignored so future persisted shapes still restore. Migrates the
// pre-mode-objects shape (enabled boolean) alongside the current one.
function decodeStateData(data: unknown): PlanModeState | undefined {
  if (!isRecord(data)) return undefined
  const planning = data.mode === "planning" || data.enabled === true
  return {
    mode: planning ? "planning" : "default",
    plan: decodedPlan(data.plan),
    activePlan: decodedPlan(data.activePlan),
    toolsBeforePlanMode: decodedStringArray(data.toolsBeforePlanMode),
  }
}

// A persisted plan must still validate before it is displayed
function decodedPlan(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = normalizePlanCompletion(value)
  return normalized.ok ? normalized.plan : undefined
}

function decodedStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string" && item.trim().length > 0)
    ? value
    : undefined
}

// Source (adapted: planModeCompletionMarkdown → toolResultText, generic over any
// result's content rather than a plan completion's):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/completion-tool.ts
// Deviates from the source: no planFromCompletionDetails fallback - pi always hands
// renderResult a populated content (AgentToolResult.content is required; thrown errors become
// text results), and persisted-plan recovery from details is decodedPlanCompletion below.
// The joined text of a tool result's text content blocks, trimmed - the
// renderable transcript of the result
export function toolResultText<T>(result: AgentToolResult<T>): string {
  return result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim()
}

// Recover the plan from the newest plan_complete toolResult after the state
// entry (covers a crash between the tool call and the next persist).
function decodedPlanCompletion(entries: SessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.type !== "message") continue
    const message = entry.message
    if (message.role !== "toolResult" || message.toolName !== PLAN_COMPLETE_TOOL_NAME) continue
    const plan = planFromDetails(message.details)
    if (plan) return plan
  }
  return undefined
}

// plan_complete's details payload, vetted for identity before the plan read
function planFromDetails(details: unknown): string | undefined {
  if (!isRecord(details)) return undefined
  if (details.version !== PLAN_COMPLETE_VERSION || details.source !== PLAN_COMPLETE_TOOL_NAME) {
    return undefined
  }
  return decodedPlan(details.plan)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
