// Shared fixtures: session-entry builders mirroring the shapes pi persists to
// the session JSONL, plus the canonical two-phase plan the tests decode and swap

import type { JsonValue } from "@earendil-works/pi-ai"
import type { SessionEntry } from "@earendil-works/pi-coding-agent"

export const PLAN = "## 1. Core\nSwap the field.\n\n## 2. Verification\nmake test."

// oxlint-disable-next-line unicorn/no-null -- pi persists parentId as null (SessionEntry.parentId: string | null); undefined breaks the type
export const entryBase = { id: "e0", parentId: null, timestamp: "2025-01-01T00:00:00.000Z" }

export const stateEntry = (data: unknown, ...after: SessionEntry[]): SessionEntry[] => [
  { type: "custom", customType: "plan-mode", data, ...entryBase },
  ...after,
]

export const planCompleteResult = (details: JsonValue): SessionEntry => ({
  type: "message",
  ...entryBase,
  message: {
    role: "toolResult",
    toolCallId: "tc0",
    toolName: "plan_complete",
    content: [],
    isError: false,
    timestamp: 0,
    details,
  },
})

export const userEntry: SessionEntry = {
  type: "message",
  ...entryBase,
  message: { role: "user", content: "and then?", timestamp: 0 },
}
