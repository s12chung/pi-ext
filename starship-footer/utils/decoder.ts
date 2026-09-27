/**
 * The session boundary and the only home of `unknown`: pi types the active
 * model as Model<any>, and session entries round-trip through JSON on disk,
 * so their payloads are only as trustworthy as the file they were read from.
 * This module decodes them into the footer's typed shapes; index.ts does the
 * decoding, and nothing past it touches an unvetted value.
 */

import type { ContextUsage, SessionEntry } from "@earendil-works/pi-coding-agent"

export interface ModelInfo {
  // The model id, or undefined when no model is active
  id: string | undefined
  // Provider id (e.g. "anthropic"); state.ts pretty-names it
  provider: string | undefined
  // The model's context window in tokens
  contextWindow: number | undefined
}

export interface ContextSnapshot {
  // Context usage as a percentage of the window, or undefined when unknown
  // (e.g. right after compaction, before the next LLM response)
  percent: number | undefined
  // The context window to compare against, or undefined when unknown
  contextWindow: number | undefined
}

// pi's ThinkingLevel union (pi-agent-core): the session's thinking setting
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export function decodeModelInfo(model: unknown): ModelInfo {
  if (!isRecord(model)) return { id: undefined, provider: undefined, contextWindow: undefined }
  return {
    id: decodedString(model.id),
    provider: decodedString(model.provider),
    contextWindow: decodedCount(model.contextWindow),
  }
}

// Sum the session's cost over the entries zentui counts: assistant and
// toolResult messages plus the compaction and branch_summary LLM calls.
// A drifted session file must not be able to inject NaN or Infinity here.
export function decodeSessionCost(entries: readonly SessionEntry[]): number {
  let cost = 0
  for (const entry of entries) {
    if (entry.type === "message") {
      const message: unknown = entry.message
      if (!isRecord(message)) continue
      if (message.role !== "assistant" && message.role !== "toolResult") continue
      cost = addCapped(cost, usageCost(message.usage))
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      const usage: unknown = entry.usage
      cost = addCapped(cost, usageCost(usage))
    }
  }
  return cost
}

// pi's live context usage is typed (ContextUsage), not disk-round-tripped, so
// only the percent-null case needs decoding here. The model's window wins over
// the session estimate (zentui resolveContextUsage's ?? merge)
export function decodeContextSnapshot(
  usage: ContextUsage | undefined,
  modelContextWindow: number | undefined,
): ContextSnapshot {
  return {
    percent:
      usage !== undefined && usage.percent !== null && Number.isFinite(usage.percent)
        ? usage.percent
        : undefined,
    contextWindow: modelContextWindow ?? usage?.contextWindow,
  }
}

export function decodeThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).find(
    (level) => level === value,
  )
}

function usageCost(usage: unknown): number {
  if (!isRecord(usage) || !isRecord(usage.cost)) return 0
  return decodedCount(usage.cost.total) ?? 0
}

function decodedCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function decodedString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

// Cap instead of overflowing to Infinity, like zentui's addUsageTotal
function addCapped(total: number, value: number): number {
  const sum = total + value
  return Number.isFinite(sum) ? sum : Number.MAX_VALUE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
