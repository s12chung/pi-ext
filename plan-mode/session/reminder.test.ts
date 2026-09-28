import assert from "node:assert/strict"
import { test } from "node:test"
import type { ContextEvent } from "@earendil-works/pi-coding-agent"
import { PROMPTS } from "../config.ts"
import { DefaultMode, PlanningMode } from "../mode.ts"
import { applyReminders } from "./reminder.ts"

type Messages = ContextEvent["messages"]

const userTurn = (text: string): Messages => [{ role: "user", content: text, timestamp: 0 }]

// A mid-run transcript: the request tail is the newest tool result
const midRun = (): Messages => [
  userTurn("explore the cache behavior")[0],
  {
    role: "assistant",
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-test",
    content: [{ type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" } }],
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 0,
  },
  {
    role: "toolResult",
    toolCallId: "tc1",
    toolName: "bash",
    content: [{ type: "text", text: "index.ts" }],
    isError: false,
    timestamp: 0,
  },
]

const tailLastText = (messages: Messages | undefined): string => {
  const tail = messages?.at(-1)
  if (!tail || (tail.role !== "user" && tail.role !== "toolResult"))
    throw new Error("no remindable tail")
  const last = Array.isArray(tail.content) ? tail.content.at(-1) : undefined
  if (!last || last.type !== "text" || typeof last.text !== "string")
    throw new Error("expected a trailing text block")
  return last.text
}

test("planning appends the plan-mode prompt on a fresh-turn tail", () => {
  const messages = userTurn("explore the cache behavior")
  const reminded = applyReminders(new PlanningMode(), false, messages)

  const text = tailLastText(reminded)
  assert.match(text, /\[PLAN MODE ACTIVE\]/u)
  assert.match(text, /MUST NOT/u)
  assert.match(text, /ONLY inside a temporary folder/u)
  // The real transcript keeps its string content - the reminder is request-local
  const head = messages[0]
  if (!head || head.role !== "user" || typeof head.content !== "string")
    throw new Error("expected a string-content user head")
  assert.notEqual(reminded, messages)
})

test("a configured prompt replaces the built-in", (t) => {
  const original = { ...PROMPTS }
  t.after(() => Object.assign(PROMPTS, original))

  Object.assign(PROMPTS, { planModePrompt: "CUSTOM PROMPT" })
  const reminded = applyReminders(new PlanningMode(), false, userTurn("go"))
  assert.equal(tailLastText(reminded), "CUSTOM PROMPT")

  // The configured note replaces the built-in the same way
  Object.assign(PROMPTS, { planModeEndedPrompt: "CUSTOM NOTE" })
  const ended = applyReminders(new DefaultMode(), true, userTurn("go"))
  assert.equal(tailLastText(ended), "CUSTOM NOTE")
})

test("planning appends on a mid-run tool-result tail", () => {
  const messages = midRun()
  const reminded = applyReminders(new PlanningMode(), false, messages)

  assert.match(tailLastText(reminded), /\[PLAN MODE ACTIVE\]/u)
  // Earlier messages are passed through untouched
  assert.deepEqual(reminded?.slice(0, -1), messages.slice(0, -1))
  const tail = reminded?.at(-1)
  if (!tail || tail.role !== "toolResult") throw new Error("expected a toolResult tail")
  assert.deepEqual(tail.content.slice(0, -1), [{ type: "text", text: "index.ts" }])
})

test("the switch note rides default requests after an exit", () => {
  const reminded = applyReminders(new DefaultMode(), true, userTurn("thanks, go"))
  assert.match(tailLastText(reminded), /\[PLAN MODE ENDED\]/u)
})

test("default without an exit is a no-op", () => {
  assert.equal(applyReminders(new DefaultMode(), false, userTurn("hi")), undefined)
  assert.equal(applyReminders(new DefaultMode(), false, []), undefined)
  // An assistant tail is not a request-time tail
  assert.equal(applyReminders(new DefaultMode(), true, midRun().slice(0, 2)), undefined)
})

test("applying twice does not stack reminders", () => {
  const once = applyReminders(new PlanningMode(), false, userTurn("go"))
  assert.ok(once)

  // The reminded transcript already carries the prompt: nothing more to append
  assert.equal(applyReminders(new PlanningMode(), false, once), undefined)
  assert.equal(tailLastText(once).split("[PLAN MODE ACTIVE]").length - 1, 1)
})
