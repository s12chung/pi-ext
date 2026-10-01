import assert from "node:assert/strict"
import { test } from "node:test"
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent"
import planModeExtension from "./index.ts"
import {
  PLAN,
  agentDirWith,
  planCompleteResult,
  stateEntry,
  uiFake,
  userEntry,
  withAgentDirEnv,
} from "./utils/fixtures.ts"

type RegisteredTool = {
  name: string
  execute: (toolCallId: string, params: { plan: string }) => Promise<unknown>
}

type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>
}

// Fakes for planModeExtension's registration surface; entries records what the
// extension persists, sentMessages the custom messages it sends, and
// activeToolSets the reconcile calls
interface ExtensionFixture {
  tool: (name: string) => RegisteredTool
  command: (name: string) => RegisteredCommand
  sessionStart: (ctx: ExtensionContext) => void
  beforeAgentStart: (entries?: SessionEntry[]) => Promise<Record<string, string>>
  agentSettled: (ctx: ExtensionContext) => Promise<void>
  activeToolSets: string[][]
  entries: Array<[string, unknown]>
  sentMessages: Array<{
    message: { customType: string; content: string; display: boolean }
    options: unknown
  }>
}

function extension(): ExtensionFixture {
  const tools = new Map<string, RegisteredTool>()
  const commands = new Map<string, RegisteredCommand>()
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>()
  const entries: Array<[string, unknown]> = []
  const activeToolSets: string[][] = []
  const sentMessages: ExtensionFixture["sentMessages"] = []
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      handlers.set(event, handler),
    getActiveTools: () => ["read", "bash"],
    setActiveTools: (toolNames: string[]) => activeToolSets.push(toolNames),
    appendEntry: (customType: string, data: unknown) => entries.push([customType, data]),
    sendMessage: (
      message: { customType: string; content: string; display: boolean },
      options: unknown,
    ) => sentMessages.push({ message, options }),
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

// The constant loadout: pi's active set first, then the additions in canonical
// order
const CONSTANT_TOOL_SET = ["read", "bash", "grep", "find", "ls", "questionnaire", "plan_complete"]

test("session_start restores into either mode silently", () => {
  const ext = extension()
  const session = uiFake() // no plan-mode entry: the extension's default restores
  ext.sessionStart(session.ctx)

  const planning = uiFake({ entries: stateEntry({ mode: "planning" }) })
  ext.sessionStart(planning.ctx)

  assert.deepEqual(session.notifies, [])
  assert.deepEqual(planning.notifies, [])
})

test("session_start reconciles the active tools into the constant set", () => {
  const ext = extension()
  ext.sessionStart(uiFake().ctx)

  // Swap-era sessions restore transcript-recorded loadouts; the reconcile
  // unions whatever pi restored with the additions - once, never again
  const resumed = uiFake({ entries: stateEntry({ mode: "planning" }) })
  ext.sessionStart(resumed.ctx)

  assert.deepEqual(ext.activeToolSets, [CONSTANT_TOOL_SET, CONSTANT_TOOL_SET])
})

test("plan_complete stages the plan on the live mode and persists it", async () => {
  const ext = extension()
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning" }) }).ctx)

  await ext.tool("plan_complete").execute("t1", { plan: PLAN })

  assert.deepEqual(ext.entries, [["plan-mode", { mode: "planning", plan: PLAN }]])
})

test("plan_complete refuses outside planning and persists nothing", () => {
  const ext = extension()
  ext.sessionStart(uiFake().ctx)

  assert.throws(
    () => ext.tool("plan_complete").execute("t1", { plan: PLAN }),
    /only available while plan mode is active/u,
  )
  assert.deepEqual(ext.entries, [])
})

test("plan_complete stages the trimmed plan", async () => {
  const ext = extension()
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning" }) }).ctx)

  const result = (await ext.tool("plan_complete").execute("t1", { plan: `\n${PLAN}\n` })) as {
    details: { plan: string }
  }

  assert.equal(result.details.plan, PLAN)
  assert.deepEqual(ext.entries, [["plan-mode", { mode: "planning", plan: PLAN }]])
})

test("the planning prompt rides the system-prompt section and persists nothing", async () => {
  const ext = extension()
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning" }) }).ctx)

  const sections = await ext.beforeAgentStart(stateEntry({ mode: "planning" }))

  assert.match(sections["plan-mode"] ?? "", /\[PLAN MODE ACTIVE\]/u)
  assert.deepEqual(ext.entries, [])
})

test("the default mode contributes no section", async () => {
  const ext = extension()
  ext.sessionStart(uiFake().ctx)

  assert.equal("plan-mode" in (await ext.beforeAgentStart()), false)
})

test("agent_settled menus only when the branch ends on the completion result", async () => {
  const ext = extension()

  // The staged plan alone owes nothing: a follow-up user turn landed past the
  // completion result, so the settle stays silent
  const followUp = uiFake({
    choice: "Exit plan mode (plan stays in context)",
    entries: stateEntry({ mode: "planning", plan: PLAN }, planCompleteResult({}), userEntry),
  })
  ext.sessionStart(followUp.ctx)
  await ext.agentSettled(followUp.ctx)
  assert.deepEqual(followUp.notifies, [])
  assert.deepEqual(ext.entries, [])

  const menu = uiFake({
    choice: "Exit plan mode (plan stays in context)",
    entries: stateEntry({ mode: "planning", plan: PLAN }, planCompleteResult({})),
  })
  ext.sessionStart(menu.ctx)
  await ext.agentSettled(menu.ctx)

  assert.deepEqual(menu.notifies, ["Plan mode disabled."])
  assert.deepEqual(ext.entries, [["plan-mode", { mode: "default" }]])
})

test("an exit sends the persisted switch note once", async () => {
  const ext = extension()
  ext.sessionStart(uiFake().ctx)
  await ext.command("plan").handler("", uiFake().ctx) // default -> planning sends nothing
  assert.equal(ext.sentMessages.length, 0)

  const menu = uiFake({ choice: "Exit plan mode (plan stays in context)" })
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning", plan: PLAN }) }).ctx)
  await ext.command("plan").handler("", menu.ctx)

  assert.equal(ext.sentMessages.length, 1)
  const { message, options } = ext.sentMessages[0]
  assert.equal(message.customType, "plan-mode-ended")
  assert.match(message.content, /\[PLAN MODE ENDED\]/u)
  assert.equal(message.display, false)
  assert.equal(options, undefined) // no turn: the note only rides the next prompt
  assert.equal("plan-mode" in (await ext.beforeAgentStart(stateEntry({ mode: "default" }))), false)
})

test("/plan menu exit leaves planning and persists the default state", async () => {
  const ext = extension()
  const session = uiFake({ entries: stateEntry({ mode: "planning", plan: PLAN }) })
  ext.sessionStart(session.ctx)
  assert.deepEqual(session.notifies, [])

  const menu = uiFake({ choice: "Exit plan mode (plan stays in context)" })
  await ext.command("plan").handler("", menu.ctx)

  assert.deepEqual(ext.entries, [["plan-mode", { mode: "default" }]])
  assert.deepEqual(menu.notifies, ["Plan mode disabled."])
})

test("/plan menu stay keeps planning and persists nothing", async () => {
  const ext = extension()
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning", plan: PLAN }) }).ctx)

  const menu = uiFake({ choice: "Stay in plan mode" })
  await ext.command("plan").handler("", menu.ctx)

  assert.deepEqual(ext.entries, [])
  assert.deepEqual(menu.notifies, ["/plan will prompt the approval."])
})

test("plan-mode.json overrides ride the section and notify nothing", async (t) => {
  const dir = agentDirWith(t, JSON.stringify({ planModePrompt: "CUSTOM PLAN PROMPT" }))
  withAgentDirEnv(t, dir)

  const ext = extension()
  const session = uiFake({ entries: stateEntry({ mode: "planning" }) })
  ext.sessionStart(session.ctx)

  assert.match((await ext.beforeAgentStart())["plan-mode"] ?? "", /CUSTOM PLAN PROMPT/u)
  assert.deepEqual(session.notifies, [])
})

test("a malformed plan-mode.json warns once, on the first session_start", (t) => {
  withAgentDirEnv(t, agentDirWith(t, "{broken"))

  const ext = extension()
  const session = uiFake()
  ext.sessionStart(session.ctx)
  assert.equal(session.notifies.length, 1)
  assert.match(session.notifies[0], /plan-mode\.json/u)

  // Cleared after the first notify: a replacement session stays silent
  const replacement = uiFake()
  ext.sessionStart(replacement.ctx)
  assert.deepEqual(replacement.notifies, [])
})
