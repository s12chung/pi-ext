// Shared fixtures: session-entry builders mirroring the shapes pi persists to
// the session JSONL, a dialog-capable fake ctx for the UI surface, and the
// canonical two-phase plan the tests decode and swap

import type { JsonValue } from "@earendil-works/pi-ai"
import type { ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent"

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

// A dialog-capable fake ctx: select resolves to choice (Esc when absent),
// notify/setEditorText/editor record the UI side effects tests assert on, and
// entries feed sessionManager.getEntries for the restore path
interface UiFake {
  ctx: ExtensionCommandContext
  notifies: string[]
  editorTexts: string[]
  editors: string[]
}

export function uiFake({
  choice,
  entries = [],
}: { choice?: string; entries?: SessionEntry[] } = {}): UiFake {
  const notifies: string[] = []
  const editorTexts: string[] = []
  const editors: string[] = []
  const ctx = {
    hasUI: true,
    sessionManager: { getEntries: (): SessionEntry[] => entries },
    ui: {
      select: (): Promise<string | undefined> => Promise.resolve(choice),
      editor: (title: string) => {
        editors.push(title)
        return Promise.resolve(undefined)
      },
      notify: (message: string) => notifies.push(message),
      setStatus: () => {},
      setEditorText: (text: string) => editorTexts.push(text),
      getEditorComponent: () => undefined,
      setEditorComponent: () => {},
      theme: { fg: (_role: string, text: string) => text },
    },
  } as unknown as ExtensionCommandContext
  return { ctx, notifies, editorTexts, editors }
}
