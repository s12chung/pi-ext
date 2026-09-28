import assert from "node:assert/strict"
import { chmodSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULT_PROMPTS, PROMPTS, loadPrompts, resolveAgentDir } from "./config.ts"
import { agentDirWith, withAgentDirEnv } from "./utils/fixtures.ts"

test("PROMPTS starts as the built-ins", () => {
  assert.deepEqual(PROMPTS, DEFAULT_PROMPTS)
})

test("a missing config file is silent defaults", (t) => {
  const { prompts, warning } = loadPrompts(agentDirWith(t))

  assert.deepEqual(prompts, DEFAULT_PROMPTS)
  assert.equal(warning, undefined)
})

test("string values overlay the defaults key by key", (t) => {
  const dir = agentDirWith(
    t,
    JSON.stringify({ planModePrompt: "PROMPT", planCommandDescription: "CMD" }),
  )
  const { prompts, warning } = loadPrompts(dir)

  assert.equal(prompts.planModePrompt, "PROMPT")
  assert.equal(prompts.planCommandDescription, "CMD")
  assert.equal(prompts.planModeEndedPrompt, DEFAULT_PROMPTS.planModeEndedPrompt)
  assert.equal(prompts.questionnaireDescription, DEFAULT_PROMPTS.questionnaireDescription)
  assert.equal(warning, undefined)
})

test("malformed JSON warns and keeps the defaults", (t) => {
  const { prompts, warning } = loadPrompts(agentDirWith(t, "{nope"))

  assert.deepEqual(prompts, DEFAULT_PROMPTS)
  assert.ok(warning)
  assert.match(warning, /plan-mode\.json/u)
})

test("a non-object config warns and keeps the defaults", (t) => {
  for (const body of ["[]", "3", '"x"', "null"]) {
    const { prompts, warning } = loadPrompts(agentDirWith(t, body))
    assert.deepEqual(prompts, DEFAULT_PROMPTS)
    assert.ok(warning)
    assert.match(warning, /plan-mode\.json.*expected a JSON object/u)
  }
})

test("unknown and non-string keys are ignored and named in the warning", (t) => {
  const dir = agentDirWith(
    t,
    JSON.stringify({
      questionnaireDescription: "ASK",
      planCompleteDescription: "",
      planFormatDescription: 42,
      planCommandDescription: "   ",
      unknownKey: "x",
    }),
  )
  const { prompts, warning } = loadPrompts(dir)

  assert.equal(prompts.questionnaireDescription, "ASK")
  assert.equal(prompts.planCompleteDescription, DEFAULT_PROMPTS.planCompleteDescription)
  assert.equal(prompts.planFormatDescription, DEFAULT_PROMPTS.planFormatDescription)
  assert.equal(prompts.planCommandDescription, DEFAULT_PROMPTS.planCommandDescription)
  assert.ok(warning)
  assert.match(warning, /planCompleteDescription \(not a non-empty string\)/u)
  assert.match(warning, /planFormatDescription \(not a non-empty string\)/u)
  assert.match(warning, /planCommandDescription \(not a non-empty string\)/u)
  assert.match(warning, /unknownKey \(unknown key\)/u)
})

test("prototype-inherited names are unknown keys, not prompt keys", (t) => {
  const dir = agentDirWith(t, JSON.stringify({ toString: "x", constructor: 42 }))
  const { prompts, warning } = loadPrompts(dir)

  assert.deepEqual(prompts, DEFAULT_PROMPTS)
  assert.ok(warning)
  assert.match(warning, /toString \(unknown key\)/u)
  assert.match(warning, /constructor \(unknown key\)/u)
})

test("an unreadable config file warns with the path and error", (t) => {
  const dir = agentDirWith(t, JSON.stringify({}))
  chmodSync(join(dir, "plan-mode.json"), 0o000)
  const { prompts, warning } = loadPrompts(dir)

  assert.deepEqual(prompts, DEFAULT_PROMPTS)
  assert.ok(warning)
  assert.match(warning, /plan-mode\.json/u)
})

test("PI_CODING_AGENT_DIR selects the config directory", (t) => {
  const dir = agentDirWith(t, JSON.stringify({ planModePrompt: "ENV PROMPT" }))
  withAgentDirEnv(t, dir)

  assert.equal(resolveAgentDir(), dir)
  assert.equal(loadPrompts().prompts.planModePrompt, "ENV PROMPT")
})

test("without the env var the agent dir falls back to ~/.pi/agent", (t) => {
  withAgentDirEnv(t, undefined)

  assert.equal(resolveAgentDir(), join(homedir(), ".pi", "agent"))
})
