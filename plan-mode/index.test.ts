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
// extension persists
interface ExtensionFixture {
  tool: (name: string) => RegisteredTool
  command: (name: string) => RegisteredCommand
  sessionStart: (ctx: ExtensionContext) => void
  entries: Array<[string, unknown]>
}

function extension(): ExtensionFixture {
  const tools = new Map<string, RegisteredTool>()
  const commands = new Map<string, RegisteredCommand>()
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>()
  const entries: Array<[string, unknown]> = []
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) =>
      handlers.set(event, handler),
    getActiveTools: () => ["read", "bash"],
    setActiveTools: () => {},
    appendEntry: (customType: string, data: unknown) => entries.push([customType, data]),
  } as unknown as ExtensionAPI
  planModeExtension(pi)
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
    entries,
  }
}

test("session_start restores into either mode silently", () => {
  const ext = extension()
  const session = uiFake() // no plan-mode entry: the extension's default restores
  ext.sessionStart(session.ctx)

  const planning = uiFake({ entries: stateEntry({ mode: "planning" }) })
  ext.sessionStart(planning.ctx)

  assert.deepEqual(session.notifies, [])
  assert.deepEqual(planning.notifies, [])
})

test("plan_complete stages the plan on the live mode and persists it", async () => {
  const ext = extension()
  ext.sessionStart(
    uiFake({ entries: stateEntry({ mode: "planning", toolsBeforePlanMode: ["read"] }) }).ctx,
  )

  await ext.tool("plan_complete").execute("t1", { plan: PLAN })

  assert.deepEqual(ext.entries, [
    ["plan-mode", { mode: "planning", plan: PLAN, toolsBeforePlanMode: ["read"] }],
  ])
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
  assert.deepEqual(ext.entries, [
    ["plan-mode", { mode: "planning", plan: PLAN, toolsBeforePlanMode: ["read", "bash"] }],
  ])
})

test("/plan menu exit leaves planning and persists the default state", async () => {
  const ext = extension()
  const session = uiFake({ entries: stateEntry({ mode: "planning", plan: PLAN }) })
  ext.sessionStart(session.ctx)
  assert.deepEqual(session.notifies, [])

  const menu = uiFake({ choice: "Exit plan mode (plan stays in context)" })
  await ext.command("plan").handler("", menu.ctx)

  // enter() snapshots the active tools on entering planning; exit carries them back
  assert.deepEqual(ext.entries, [
    ["plan-mode", { mode: "default", toolsBeforePlanMode: ["read", "bash"] }],
  ])
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
