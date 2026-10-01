// Shared fixtures: session-entry builders mirroring the shapes pi persists to
// the session JSONL, a dialog-capable fake ctx for the UI surface, the
// canonical two-phase plan the tests decode and swap, and temp agent dirs for
// config loading

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TestContext } from "node:test"
import type { JsonValue } from "@earendil-works/pi-ai"
import type { ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent"

export const PLAN = "## 1. Core\nSwap the field.\n\n## 2. Verification\nmake test."

// oxlint-disable-next-line unicorn/no-null -- pi persists parentId as null (SessionEntry.parentId: string | null); undefined breaks the type
export const entryBase = { id: "e0", parentId: null, timestamp: "2025-01-01T00:00:00.000Z" }

export const stateEntry = (data: unknown, ...after: SessionEntry[]): SessionEntry[] => [
  { type: "custom", customType: "plan-mode", data, ...entryBase },
  ...after,
]

export const toolResultEntry = (toolName: string, details: JsonValue = {}): SessionEntry => ({
  type: "message",
  ...entryBase,
  message: {
    role: "toolResult",
    toolCallId: "tc0",
    toolName,
    content: [],
    isError: false,
    timestamp: 0,
    details,
  },
})

export const planCompleteResult = (details: JsonValue): SessionEntry =>
  toolResultEntry("plan_complete", details)

export const userEntry: SessionEntry = {
  type: "message",
  ...entryBase,
  message: { role: "user", content: "and then?", timestamp: 0 },
}

// A temp agent dir for config tests; a body string writes plan-mode.json into
// it, undefined leaves it empty (the missing-file case). Removed at test end.
export function agentDirWith(t: TestContext, body?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-mode-config-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  if (body !== undefined) writeFileSync(join(dir, "plan-mode.json"), body)
  return dir
}

// Points PI_CODING_AGENT_DIR at value (undefined clears it) for the test's
// duration, restoring the previous value afterwards
export function withAgentDirEnv(t: TestContext, value: string | undefined): void {
  const original = process.env.PI_CODING_AGENT_DIR
  t.after(() => {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = original
  })
  if (value === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = value
}

// A dialog-capable fake ctx: select resolves to choice (Esc when absent),
// notify/setEditorText/editor record the UI side effects tests assert on, and
// entries feed sessionManager.getEntries (restore) and getBranch (the settle
// gate) the same active path
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
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: {
      getEntries: (): SessionEntry[] => entries,
      getBranch: (): SessionEntry[] => entries,
    },
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
