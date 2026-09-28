import assert from "node:assert/strict"
import { test } from "node:test"
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import planModeExtension from "./index.ts"
import { PLAN, stateEntry, uiFake } from "./utils/fixtures.ts"

type RegisteredTool = {
  name: string
  execute: (toolCallId: string, params: { plan: string }) => Promise<unknown>
}

type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>
}

// Fakes for planModeExtension's registration surface; entries records what the
// extension persists, activeToolSets records the reconcile calls
interface ExtensionFixture {
  tool: (name: string) => RegisteredTool
  command: (name: string) => RegisteredCommand
  sessionStart: (ctx: ExtensionContext) => void
  context: (messages: unknown) => { messages?: unknown[] } | undefined
  activeToolSets: string[][]
  entries: Array<[string, unknown]>
}

function extension(): ExtensionFixture {
  const tools = new Map<string, RegisteredTool>()
  const commands = new Map<string, RegisteredCommand>()
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>()
  const entries: Array<[string, unknown]> = []
  const activeToolSets: string[][] = []
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      handlers.set(event, handler),
    getActiveTools: () => ["read", "bash"],
    setActiveTools: (toolNames: string[]) => activeToolSets.push(toolNames),
    appendEntry: (customType: string, data: unknown) => entries.push([customType, data]),
  } as unknown as ExtensionAPI
  planModeExtension(pi)
  return {
    ...accessors(tools, commands, handlers),
    activeToolSets,
    entries,
  }
}

// The typed views over the registration surface: each asserts its handler or
// registration exists before handing it out
function accessors(
  tools: Map<string, RegisteredTool>,
  commands: Map<string, RegisteredCommand>,
  handlers: Map<string, (event: unknown, ctx: ExtensionContext) => unknown>,
): Pick<ExtensionFixture, "tool" | "command" | "sessionStart" | "context"> {
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
    context: (messages) => {
      const handler = handlers.get("context")
      assert.ok(handler, "context registered")
      return handler({ type: "context", messages }, {} as ExtensionContext) as
        | { messages?: unknown[] }
        | undefined
    },
  }
}

// The constant loadout: pi's active set first, then the additions in canonical
// order
const CONSTANT_TOOL_SET = ["read", "bash", "grep", "find", "ls", "questionnaire", "plan_complete"]

const tailText = (out: { messages?: unknown[] } | undefined): string => {
  const tail = out?.messages?.at(-1) as
    | { content?: Array<{ type: string; text?: string }> }
    | undefined
  const last = tail?.content?.at(-1)
  assert.ok(last && last.type === "text" && typeof last.text === "string")
  return last.text
}

const userTurn = (text: string): unknown => [{ role: "user", content: text, timestamp: 0 }]

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

test("the planning reminder rides the request tail and persists nothing", () => {
  const ext = extension()
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning" }) }).ctx)

  const out = ext.context(userTurn("explore the cache"))

  assert.match(tailText(out), /\[PLAN MODE ACTIVE\]/u)
  assert.deepEqual(ext.entries, [])
})

test("default requests carry the switch note only after an exit", async () => {
  const ext = extension()
  ext.sessionStart(uiFake().ctx)
  assert.equal(ext.context(userTurn("go")), undefined)

  const session = uiFake({ entries: stateEntry({ mode: "planning", plan: PLAN }) })
  ext.sessionStart(session.ctx)
  const menu = uiFake({ choice: "Exit plan mode (plan stays in context)" })
  await ext.command("plan").handler("", menu.ctx)

  assert.match(tailText(ext.context(userTurn("go"))), /\[PLAN MODE ENDED\]/u)
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
