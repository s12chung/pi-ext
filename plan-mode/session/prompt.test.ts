import assert from "node:assert/strict"
import { test } from "node:test"
import { DefaultMode, PlanningMode } from "../mode.ts"
import { PLAN_MODE_SECTION, safeSetSection } from "./prompt.ts"

test("planning mode installs its prompt under the plan-mode section", () => {
  const sections: Record<string, string> = {}
  safeSetSection(new PlanningMode().systemPrompt(), sections)
  assert.match(sections[PLAN_MODE_SECTION] ?? "", /\[PLAN MODE ACTIVE\]/u)
})

test("an empty prompt never removes the section and is a no-op when absent", () => {
  const sections: Record<string, string> = {}
  safeSetSection(new DefaultMode().systemPrompt(), sections)
  assert.equal(PLAN_MODE_SECTION in sections, false)

  // The exit keeps the section: removing it broke the cache (prompt.ts)
  sections[PLAN_MODE_SECTION] = "stale"
  safeSetSection("", sections)
  assert.equal(sections[PLAN_MODE_SECTION], "stale")
})

test("an unchanged prompt skips the write", () => {
  const prompt = new PlanningMode().systemPrompt()
  let writes = 0
  const sections: Record<string, string> = {}
  Object.defineProperty(sections, PLAN_MODE_SECTION, {
    configurable: true,
    get: () => prompt,
    set: () => {
      writes += 1
    },
  })

  safeSetSection(prompt, sections)
  assert.equal(writes, 0)
})
