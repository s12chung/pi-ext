import assert from "node:assert/strict"
import { test } from "node:test"
import type { AgentToolResult } from "@earendil-works/pi-coding-agent"
import { type PlanCompletionDetails, completionTool } from "./completion.ts"

const PLAN =
  "## 1. Core\nSwap the field.\n\n## 2. Rendering\nHook up the consumer.\n\n## 3. Verification\nmake test."

type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: { plan: string },
  ) => Promise<AgentToolResult<PlanCompletionDetails>>
}

// The definition completionTool hands back
function definition(setPlan: (plan: string) => void = () => undefined): RegisteredTool {
  return completionTool(setPlan) as unknown as RegisteredTool
}

test("execute terminates the turn, staging and echoing the trimmed plan", async () => {
  let staged: string | undefined
  const result = await definition((plan) => {
    staged = plan
  }).execute("t1", { plan: `\n${PLAN}\n` })
  assert.equal(staged, PLAN)
  assert.equal(result.terminate, true)
  assert.deepEqual(result.content, [{ type: "text", text: `**Proposed Plan**\n\n${PLAN}` }])
  assert.deepEqual(result.details, { version: 1, source: "plan_complete", plan: PLAN })
})

test("execute surfaces format validation errors", () => {
  assert.throws(() => definition().execute("t1", { plan: "just prose" }), /phase headings/u)
})

test("execute surfaces the callback's error", () => {
  // index.ts's callback gates on plan mode before staging the plan
  assert.throws(
    () =>
      definition((plan) => {
        throw new Error(`bad plan: ${plan}`)
      }).execute("t1", { plan: PLAN }),
    /bad plan/u,
  )
})
