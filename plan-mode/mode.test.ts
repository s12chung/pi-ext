import assert from "node:assert/strict"
import { test } from "node:test"
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import { DefaultMode, type Mode, PlanningMode } from "./mode.ts"
import { PLAN } from "./utils/fixtures.ts"

test("toggle round-trips and carries the tool snapshot to default", () => {
  const planning = new DefaultMode().next()
  assert.ok(planning.isPlanning())
  assert.equal(planning.plan, undefined)

  planning.toolsBeforePlanMode = ["read", "bash"]
  const back = planning.next()
  assert.ok(back.isDefault())
  assert.deepEqual(back.toolsBeforePlanMode, ["read", "bash"])
  assert.equal(back.activePlan, undefined)
})

test("DefaultMode hands its activePlan to a fresh planning mode's discard", () => {
  const handoff = new DefaultMode(PLAN)
  const planning = handoff.next()
  assert.ok(planning.isPlanning())
  assert.equal(planning.plan, undefined)
})

test("completePlan validates before staging the plan", () => {
  const planning = new PlanningMode()
  assert.throws(() => planning.completePlan({ plan: "just prose" }), /phase headings/u)
  assert.equal(planning.plan, undefined)

  planning.completePlan({ plan: PLAN })
  assert.equal(planning.plan, PLAN)
  assert.equal(planning.shouldPromptApproval(), true)
})

test("shouldPromptApproval only while a plan is staged", () => {
  const planning = new PlanningMode()
  assert.equal(planning.shouldPromptApproval(), false)

  planning.completePlan({ plan: PLAN })
  assert.equal(planning.shouldPromptApproval(), true)

  // Opening the menu consumes the staged plan: rejection rests in explore
  planning.rejectApproval()
  assert.equal(planning.shouldPromptApproval(), false)
  assert.equal(planning.plan, undefined)

  // A refined plan restages and re-enters approval
  planning.completePlan({ plan: "## 1. Reworked\nDifferent.\n\n## 2. Verify\nTest." })
  assert.equal(planning.plan, "## 1. Reworked\nDifferent.\n\n## 2. Verify\nTest.")
  assert.equal(planning.shouldPromptApproval(), true)
})

test("DefaultMode refuses plan_complete and stays permissive", () => {
  const mode: Mode = new DefaultMode()
  assert.throws(
    () => mode.completePlan({ plan: PLAN }),
    /only available while plan mode is active/u,
  )
  assert.equal(mode.agentStartMessage(), undefined)
  assert.equal(mode.shouldPromptApproval(), false)
})

test("PlanningMode injects the plan-mode prompt with the read-only constraint", () => {
  const planning = new PlanningMode()
  const message = planning.agentStartMessage()
  assert.equal(message?.customType, "plan-mode-context")
  assert.equal(message?.display, false)
  const content = message?.content
  assert.ok(typeof content === "string" && content.includes("[PLAN MODE ACTIVE]"))
  assert.match(content, /MUST NOT/u)
  assert.match(content, /ONLY inside a temporary folder/u)
})

test("DefaultMode strips stale planning context; PlanningMode passes it through", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "custom", customType: "plan-mode-context", content: [] },
    { role: "user", content: "[PLAN MODE ACTIVE]" },
    { role: "user", content: [{ type: "text", text: "[PLAN MODE ACTIVE]" }] },
    { role: "assistant", content: [] },
    { role: "user", content: [{ type: "text", text: "plain" }] },
  ] as unknown as AgentMessage[]

  assert.equal(new DefaultMode().filterContext(messages).length, 3)
  assert.equal(new PlanningMode().filterContext(messages).length, messages.length)
})

test("toState shapes carry each mode's own fields", () => {
  assert.deepEqual(new DefaultMode().toState(), {
    mode: "default",
    activePlan: undefined,
    toolsBeforePlanMode: undefined,
  })
  assert.deepEqual(new DefaultMode(PLAN, ["read"]).toState(), {
    mode: "default",
    activePlan: PLAN,
    toolsBeforePlanMode: ["read"],
  })

  const planning = new PlanningMode()
  planning.toolsBeforePlanMode = ["read"]
  assert.deepEqual(planning.toState(), {
    mode: "planning",
    plan: undefined,
    toolsBeforePlanMode: ["read"],
  })
})
