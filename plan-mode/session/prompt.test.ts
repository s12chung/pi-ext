import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { DefaultMode, PlanningMode } from "../mode.ts"
import { safeSetSection, sectionInstalled, sendEndedNote, sendReenteredNote } from "./prompt.ts"

test("sectionInstalled reads the record live", () => {
  assert.equal(sectionInstalled(undefined), false)
  assert.equal(sectionInstalled({}), false)
  assert.equal(sectionInstalled({ "plan-mode": "prompt" }), true)
})

test("the note senders append their prompts as hidden custom messages", () => {
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
  sendReenteredNote(pi)

  assert.equal(sent.length, 2)
  assert.equal(sent[0]?.message.customType, "plan-mode-ended")
  assert.match(sent[0]?.message.content ?? "", /\[PLAN MODE ENDED\]/u)
  assert.equal(sent[1]?.message.customType, "plan-mode-reentered")
  assert.match(sent[1]?.message.content ?? "", /\[PLAN MODE RE-ENTERED\]/u)
  for (const { message, options } of sent) {
    assert.equal(message.display, false)
    assert.equal(options, undefined) // no turn: the note only rides the next prompt
  }
})

test("planning mode installs its prompt under the plan-mode section", () => {
  const sections: Record<string, string> = {}
  safeSetSection(new PlanningMode().systemPrompt(), sections)
  assert.match(sections["plan-mode"] ?? "", /\[PLAN MODE ACTIVE\]/u)
})

test("an empty prompt never removes the section and is a no-op when absent", () => {
  const sections: Record<string, string> = {}
  safeSetSection(new DefaultMode().systemPrompt(), sections)
  assert.equal("plan-mode" in sections, false)

  // The exit keeps the section: removing it broke the cache (prompt.ts)
  sections["plan-mode"] = "stale"
  safeSetSection("", sections)
  assert.equal(sections["plan-mode"], "stale")
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

  safeSetSection(prompt, sections)
  assert.equal(writes, 0)
})
