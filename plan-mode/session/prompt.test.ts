import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { DefaultMode, PlanningMode } from "../mode.ts"
import { sectionInstalled, sendEndedNote, setSection } from "./prompt.ts"

test("sectionInstalled reads the record live", () => {
  assert.equal(sectionInstalled(undefined), false)
  assert.equal(sectionInstalled({}), false)
  assert.equal(sectionInstalled({ "plan-mode": "prompt" }), true)
})

test("the ended note appends its prompt as a hidden custom message", () => {
  const sent: Array<{
    message: { customType: string; content: string; display: boolean }
    options: unknown
  }> = []
  const pi = {
    sendMessage: (
      message: { customType: string; content: string; display: boolean },
      options: unknown,
    ) => sent.push({ message, options }),
  } as unknown as ExtensionAPI

  sendEndedNote(pi)

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.message.customType, "plan-mode-ended")
  assert.match(sent[0]?.message.content ?? "", /\[PLAN MODE ENDED\]/u)
  assert.equal(sent[0]?.message.display, false)
  assert.equal(sent[0]?.options, undefined) // no turn: the note waits for the next prompt
})

test("planning mode installs its prompt under the plan-mode section", () => {
  const sections: Record<string, string> = {}
  setSection(new PlanningMode().systemPrompt(), sections)
  assert.match(sections["plan-mode"] ?? "", /\[PLAN MODE ACTIVE\]/u)
})

test("an empty prompt removes an installed section and is a no-op when absent", () => {
  const sections: Record<string, string> = {}
  setSection(new DefaultMode().systemPrompt(), sections)
  assert.equal("plan-mode" in sections, false)

  // The exit's request diffs into a persisted "Removed system prompt section"
  sections["plan-mode"] = "stale"
  setSection("", sections)
  assert.equal("plan-mode" in sections, false)
})

test("an unchanged prompt skips the write", () => {
  const prompt = new PlanningMode().systemPrompt()
  let writes = 0
  const sections: Record<string, string> = {}
  Object.defineProperty(sections, "plan-mode", {
    configurable: true,
    get: () => prompt,
    set: () => {
      writes += 1
    },
  })

  setSection(prompt, sections)
  assert.equal(writes, 0)
})
