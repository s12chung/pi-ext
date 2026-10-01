import assert from "node:assert/strict"
import { test } from "node:test"
import {
  PLAN,
  agentDirWith,
  extension,
  planCompleteResult,
  stateEntry,
  uiFake,
  userEntry,
  withAgentDirEnv,
} from "./utils/fixtures.ts"

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

test("toggles before any request stay silent - the notes key off the section", async () => {
  const ext = extension()
  ext.sessionStart(uiFake().ctx)
  await ext.command("plan").handler("", uiFake().ctx) // default -> planning
  await ext.command("plan").handler("", uiFake().ctx) // planning -> default, same turn
  assert.deepEqual(ext.sentMessages, [])

  // A restore-exit owes nothing either: this session has installed nothing
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning", plan: PLAN }) }).ctx)
  const menu = uiFake({ choice: "Exit plan mode (plan stays in context)" })
  await ext.command("plan").handler("", menu.ctx)
  assert.deepEqual(ext.sentMessages, [])
})

test("an exit after a request sends the persisted switch note once", async () => {
  const ext = extension()
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning", plan: PLAN }) }).ctx)
  await ext.beforeAgentStart(stateEntry({ mode: "planning" })) // the request installs the section

  const menu = uiFake({ choice: "Exit plan mode (plan stays in context)" })
  await ext.command("plan").handler("", menu.ctx)

  assert.equal(ext.sentMessages.length, 1)
  const { message, options } = ext.sentMessages[0]
  assert.equal(message.customType, "plan-mode-ended")
  assert.match(message.content, /\[PLAN MODE ENDED\]/u)
  assert.equal(message.display, false)
  assert.equal(options, undefined) // no turn: the note only rides the next prompt
  assert.equal("plan-mode" in (await ext.beforeAgentStart(stateEntry({ mode: "default" }))), false)
})

test("a re-entry after an exit answers with the re-entered note", async () => {
  const ext = extension()
  ext.sessionStart(uiFake({ entries: stateEntry({ mode: "planning", plan: PLAN }) }).ctx)
  await ext.beforeAgentStart(stateEntry({ mode: "planning" })) // the request installs the section

  const exit = uiFake({ choice: "Exit plan mode (plan stays in context)" })
  await ext.command("plan").handler("", exit.ctx)
  await ext.command("plan").handler("", uiFake().ctx) // fresh default: no plan, straight toggle

  assert.deepEqual(
    ext.sentMessages.map(({ message }) => message.customType),
    ["plan-mode-ended", "plan-mode-reentered"],
  )
  assert.match(ext.sentMessages[1].message.content, /\[PLAN MODE RE-ENTERED\]/u)
  assert.equal(ext.sentMessages[1].options, undefined)

  // The section never left, so the re-entry request still sees the plan prompt
  const sections = await ext.beforeAgentStart(stateEntry({ mode: "planning" }))
  assert.match(sections["plan-mode"] ?? "", /\[PLAN MODE ACTIVE\]/u)
})

test("an enter and exit inside one turn sends nothing and installs nothing", async () => {
  const ext = extension()
  ext.sessionStart(uiFake().ctx)

  await ext.command("plan").handler("", uiFake().ctx) // enter
  await ext.command("plan").handler("", uiFake().ctx) // exit before any request

  assert.deepEqual(ext.sentMessages, [])

  // The next request lands in default mode owing no section write
  assert.equal("plan-mode" in (await ext.beforeAgentStart(stateEntry({ mode: "default" }))), false)

  // A later re-enter is a fresh install: the section announces itself
  await ext.command("plan").handler("", uiFake().ctx)
  assert.deepEqual(ext.sentMessages, [])
  const sections = await ext.beforeAgentStart(stateEntry({ mode: "planning" }))
  assert.match(sections["plan-mode"] ?? "", /\[PLAN MODE ACTIVE\]/u)
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
