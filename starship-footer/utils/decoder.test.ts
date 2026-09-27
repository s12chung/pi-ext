import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import {
  decodeContextSnapshot,
  decodeModelInfo,
  decodeSessionCost,
  decodeThinkingLevel,
} from "./decoder.ts"

// oxlint-disable-next-line unicorn/no-null -- pi persists parentId as null (SessionEntry.parentId: string | null); undefined breaks the type
const entryBase = { id: "e0", parentId: null, timestamp: "2025-01-01T00:00:00.000Z" }

function messageEntry(role: string, usage?: unknown): SessionEntry {
  return {
    type: "message",
    ...entryBase,
    message: { role, content: "hi", usage },
  } as unknown as SessionEntry
}

// A compaction-shaped entry whose usage payload is deliberately unvetted
function compactionEntry(cost: unknown): SessionEntry {
  return {
    type: "compaction",
    ...entryBase,
    summary: "s",
    firstKeptEntryId: "e0",
    tokensBefore: 1,
    usage: { cost: { total: cost } },
  } as unknown as SessionEntry
}

function branchSummaryEntry(cost: unknown): SessionEntry {
  return {
    type: "branch_summary",
    ...entryBase,
    fromId: "e0",
    summary: "s",
    usage: { cost: { total: cost } },
  } as unknown as SessionEntry
}

const COST = (total: number): unknown => ({ input: 0, output: 0, cost: { total } })

test("decodeModelInfo decodes strings and a finite non-negative window", () => {
  assert.deepEqual(decodeModelInfo({ id: "m1", provider: "anthropic", contextWindow: 200_000 }), {
    id: "m1",
    provider: "anthropic",
    contextWindow: 200_000,
  })
})

test("decodeModelInfo keeps zero windows and drops invalid fields", () => {
  assert.equal(decodeModelInfo({ id: "m1", contextWindow: 0 }).contextWindow, 0)
  assert.deepEqual(decodeModelInfo({ id: 7, provider: [], contextWindow: -5 }), {
    id: undefined,
    provider: undefined,
    contextWindow: undefined,
  })
  const empty = { id: undefined, provider: undefined, contextWindow: undefined }
  assert.deepEqual(decodeModelInfo(undefined), empty)
  assert.deepEqual(decodeModelInfo("sonnet"), empty)
})

test("decodeSessionCost sums assistant, toolResult, compaction, and branch_summary usage", () => {
  const custom: SessionEntry = { type: "custom", customType: "x", ...entryBase }
  const entries = [
    messageEntry("user", COST(9)),
    messageEntry("assistant", COST(0.1)),
    messageEntry("toolResult", COST(0.2)),
    compactionEntry(0.3),
    branchSummaryEntry(0.4),
    custom,
  ]
  assert.equal(decodeSessionCost(entries), 1)
  assert.equal(decodeSessionCost([]), 0)
})

test("decodeSessionCost treats drifted payloads as zero cost", () => {
  const entries = [
    messageEntry("assistant", undefined),
    messageEntry("assistant", { cost: 5 }),
    messageEntry("assistant", { cost: { total: "free" } }),
    messageEntry("assistant", { cost: { total: Number.NaN } }),
    compactionEntry(-1),
    messageEntry("assistant", { garbage: true }),
  ]
  assert.equal(decodeSessionCost(entries), 0)
})

test("decodeSessionCost caps instead of overflowing to Infinity", () => {
  const entries = [
    messageEntry("assistant", COST(Number.MAX_VALUE)),
    messageEntry("assistant", COST(Number.MAX_VALUE)),
  ]
  assert.equal(decodeSessionCost(entries), Number.MAX_VALUE)
})

test("decodeContextSnapshot keeps finite percentages and merges windows with ?? semantics", () => {
  assert.deepEqual(decodeContextSnapshot({ percent: 12.5, contextWindow: 100_000 }, 200_000), {
    percent: 12.5,
    contextWindow: 200_000,
  })
  assert.deepEqual(decodeContextSnapshot({ percent: 12.5, contextWindow: 100_000 }, undefined), {
    percent: 12.5,
    contextWindow: 100_000,
  })
  // A zero model window wins over the session estimate, matching zentui's ??
  // oxlint-disable-next-line unicorn/no-null -- pi reports ContextUsage.percent as null, not undefined
  assert.deepEqual(decodeContextSnapshot({ percent: null, contextWindow: 100_000 }, 0), {
    percent: undefined,
    contextWindow: 0,
  })
})

test("decodeThinkingLevel accepts only pi's levels", () => {
  assert.equal(decodeThinkingLevel("off"), "off")
  assert.equal(decodeThinkingLevel("high"), "high")
  assert.equal(decodeThinkingLevel("max"), "max")
  assert.equal(decodeThinkingLevel("HIGH"), undefined)
  assert.equal(decodeThinkingLevel("turbo"), undefined)
  assert.equal(decodeThinkingLevel(undefined), undefined)
  assert.equal(decodeThinkingLevel(7), undefined)
})

test("decodeContextSnapshot drops unknown or malformed usage", () => {
  const unknown = { percent: undefined, contextWindow: undefined }
  assert.deepEqual(decodeContextSnapshot(undefined, undefined), unknown)
  assert.deepEqual(decodeContextSnapshot("usage", undefined), unknown)
  assert.deepEqual(
    decodeContextSnapshot({ percent: "high", contextWindow: "big" }, undefined),
    unknown,
  )
})
