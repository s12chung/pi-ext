// Shared fixtures: session-entry builders mirroring the shapes pi persists to
// the session JSONL, a dialog-capable fake ctx for the UI surface, the
// canonical two-phase plan the tests decode and swap, and temp agent dirs for
// config loading

import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TestContext } from "node:test"
import type { JsonValue } from "@earendil-works/pi-ai"
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent"
import planModeExtension from "../index.ts"

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

type RegisteredTool = {
  name: string
  execute: (toolCallId: string, params: { plan: string }) => Promise<unknown>
}

type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>
}

type SentNote = {
  message: { customType: string; content: string; display: boolean }
  options: unknown
}

// Fakes for planModeExtension's registration surface; entries records what the
// extension persists, sentMessages the custom messages it sends, and
// activeToolSets the reconcile calls
export interface ExtensionFixture {
  tool: (name: string) => RegisteredTool
  command: (name: string) => RegisteredCommand
  sessionStart: (ctx: ExtensionContext) => void
  beforeAgentStart: (entries?: SessionEntry[]) => Promise<Record<string, string>>
  agentSettled: (ctx: ExtensionContext) => Promise<void>
  activeToolSets: string[][]
  entries: Array<[string, unknown]>
  sentMessages: SentNote[]
}

export function extension(): ExtensionFixture {
  const tools = new Map<string, RegisteredTool>()
  const commands = new Map<string, RegisteredCommand>()
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>()
  const entries: Array<[string, unknown]> = []
  const activeToolSets: string[][] = []
  const sentMessages: SentNote[] = []
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      handlers.set(event, handler),
    getActiveTools: () => ["read", "bash"],
    setActiveTools: (toolNames: string[]) => activeToolSets.push(toolNames),
    appendEntry: (customType: string, data: unknown) => entries.push([customType, data]),
    sendMessage: (message: SentNote["message"], options: unknown) =>
      sentMessages.push({ message, options }),
  } as unknown as ExtensionAPI
  planModeExtension(pi)
  return {
    ...accessors(tools, commands, handlers),
    activeToolSets,
    entries,
    sentMessages,
  }
}

// The typed views over the registration surface: each asserts its handler or
// registration exists before handing it out
function accessors(
  tools: Map<string, RegisteredTool>,
  commands: Map<string, RegisteredCommand>,
  handlers: Map<string, (event: unknown, ctx: ExtensionContext) => unknown>,
): Pick<
  ExtensionFixture,
  "tool" | "command" | "sessionStart" | "beforeAgentStart" | "agentSettled"
> {
  return {
    tool: (name) => {
      const tool = tools.get(name)
      assert.ok(tool, `${name} registered`)
      return tool
    },
    command: (name) => {
      const command = commands.get(name)
      assert.ok(command, `${name} registered`)
      return command
    },
    sessionStart: (sessionCtx) => {
      const handler = handlers.get("session_start")
      assert.ok(handler, "session_start registered")
      handler({ reason: "resume" }, sessionCtx)
    },
    beforeAgentStart: async (entries: SessionEntry[] = []) => {
      const handler = handlers.get("before_agent_start")
      assert.ok(handler, "before_agent_start registered")
      const sections: Record<string, string> = {}
      const ctx = { sessionManager: { getEntries: () => entries } } as unknown as ExtensionContext
      await handler({ systemPromptOptions: { sections } }, ctx)
      return sections
    },
    agentSettled: async (sessionCtx) => {
      const handler = handlers.get("agent_settled")
      assert.ok(handler, "agent_settled registered")
      await handler({}, sessionCtx)
    },
  }
}
