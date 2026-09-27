import assert from "node:assert/strict"
import { test } from "node:test"
import type { AgentToolResult } from "@earendil-works/pi-coding-agent"
import { type PlanCompletionDetails, completionTool } from "./completion-tool.ts"
import { PlanningMode } from "./mode.ts"

const PLAN =
  "## 1. Core\nSwap the field.\n\n## 2. Rendering\nHook up the consumer.\n\n## 3. Verification\nmake test."

type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: { plan: string },
  ) => Promise<AgentToolResult<PlanCompletionDetails>>
}

// The definition completionTool hands back
function definition(): RegisteredTool {
  return completionTool(() => new PlanningMode()) as unknown as RegisteredTool
}

test("execute terminates the turn and carries the details payload", async () => {
  const result = await definition().execute("t1", { plan: PLAN })
  assert.equal(result.terminate, true)
  assert.deepEqual(result.content, [{ type: "text", text: `**Proposed Plan**\n\n${PLAN}` }])
  assert.deepEqual(result.details, { version: 1, source: "plan_complete", plan: PLAN })
})

test("execute surfaces format validation errors", () => {
  assert.throws(() => definition().execute("t1", { plan: "just prose" }), /phase headings/u)
})
