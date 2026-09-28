import assert from "node:assert/strict"
import { test } from "node:test"
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent"
import { PLAN, stateEntry } from "../utils/fixtures.ts"
import { applyModelInfo, startFreshImplementation } from "./fresh-implementation.ts"

const MODEL = { provider: "anthropic", id: "planning-model" }
const MODEL_INFO = { model: { provider: MODEL.provider, id: MODEL.id }, thinkingLevel: "high" }

// Every handoff step logs into sequence so the tests can assert ordering
interface HandoffLog {
  sequence: string[]
  entries: Array<[string, unknown]>
  models: unknown[]
  levels: string[]
  kickoffs: string[]
  notifies: string[]
}

// The fresh session's extension instance: the only pi that may dispatch a
// carried runtime (the handoff's own pi goes stale at the replacement)
function freshPi(
  log: HandoffLog,
  options: { authorized?: boolean; modelError?: string } = {},
): ExtensionAPI {
  return {
    appendEntry: (customType: string, data: unknown) => {
      log.entries.push([customType, data])
      log.sequence.push("consume")
    },
    setModel: (candidate: unknown) => {
      if (options.modelError) return Promise.reject(new Error(options.modelError))
      if (options.authorized === false) return Promise.resolve(false)
      log.models.push(candidate)
      log.sequence.push("model")
      return Promise.resolve(true)
    },
    setThinkingLevel: (level: string) => {
      log.levels.push(level)
      log.sequence.push("thinking")
    },
  } as unknown as ExtensionAPI
}

function freshCtx(
  log: HandoffLog,
  entries: SessionEntry[],
  resolved: { model?: typeof MODEL } = {},
): ExtensionContext {
  return {
    modelRegistry: {
      find: (provider: string, id: string): typeof MODEL | undefined =>
        resolved.model && provider === MODEL.provider && id === MODEL.id
          ? resolved.model
          : undefined,
    },
    sessionManager: { getEntries: (): SessionEntry[] => entries },
    ui: { notify: (message: string) => log.notifies.push(message) },
  } as unknown as ExtensionContext
}

function handoffLog(): HandoffLog {
  return { sequence: [], entries: [], models: [], levels: [], kickoffs: [], notifies: [] }
}

// The planning-session side of the handoff: setup receives the fresh session's
// manager, withSession its live replacement context
function planningCtx(
  log: HandoffLog,
  options: { model?: typeof MODEL; thinkingLevel?: string } = {},
): ExtensionCommandContext {
  const replacementCtx = {
    ui: {
      notify: (message: string): void => {
        log.notifies.push(message)
      },
      setEditorText: (): void => {},
    },
    sendUserMessage: (content: string): Promise<void> => {
      log.kickoffs.push(content)
      log.sequence.push("kickoff")
      return Promise.resolve()
    },
  }
  const freshSessionManager = {
    appendCustomEntry: (customType: string, data: unknown) => {
      log.entries.push([customType, data])
      log.sequence.push("setup")
    },
  } as unknown as SessionManager
  return {
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    sessionManager: { getSessionFile: (): string => "fake-session.jsonl" },
    ui: { notify: (message: string) => log.notifies.push(message) },
    waitForIdle: (): Promise<void> => Promise.resolve(),
    newSession: async (newSessionOptions: {
      setup?: (sessionManager: SessionManager) => void
      withSession?: (ctx: ExtensionCommandContext) => Promise<void>
    }): Promise<{ cancelled: boolean }> => {
      await newSessionOptions.setup?.(freshSessionManager)
      if (newSessionOptions.withSession) {
        await newSessionOptions.withSession(replacementCtx as unknown as ExtensionCommandContext)
      }
      return { cancelled: false }
    },
  } as unknown as ExtensionCommandContext
}

test("the handoff transfers the planning runtime through the fresh session's entry", async () => {
  const log = handoffLog()
  // No pi exists on this path at all: applying the runtime from the handoff
  // session is structurally impossible (its pi goes stale at the replacement)
  await startFreshImplementation(planningCtx(log, { model: MODEL, thinkingLevel: "high" }), PLAN)

  assert.deepEqual(log.entries, [["plan-mode", { mode: "default", modelInfo: MODEL_INFO }]])
  assert.deepEqual(log.sequence, ["setup", "kickoff"])
  assert.match(log.kickoffs[0], /approved plan/u)
  assert.deepEqual(log.notifies, [
    "Fresh implementation session started. Only the approved plan was transferred.",
  ])
})

// Model info needs a model: thinking alone is the default model's own level
test("a planning session without a model appends no model info", async () => {
  const log = handoffLog()
  await startFreshImplementation(planningCtx(log, { thinkingLevel: "high" }), PLAN)

  assert.deepEqual(log.entries, [])
  assert.equal(log.kickoffs.length, 1)
})

test("applyModelInfo selects the transferred model and thinking level, then consumes the model info", async () => {
  const log = handoffLog()
  const entries = stateEntry({ mode: "default", modelInfo: MODEL_INFO })

  await applyModelInfo(freshPi(log), freshCtx(log, entries, { model: MODEL }))

  assert.deepEqual(log.sequence, ["model", "thinking", "consume"])
  assert.deepEqual(log.models, [MODEL])
  assert.deepEqual(log.levels, ["high"])
  assert.deepEqual(log.entries, [["plan-mode", { mode: "default", plan: undefined }]])
  assert.deepEqual(log.notifies, [])
})

test("without configured auth applyModelInfo degrades to the default and consumes the model info", async () => {
  const log = handoffLog()
  const entries = stateEntry({ mode: "default", modelInfo: MODEL_INFO })

  await applyModelInfo(
    freshPi(log, { authorized: false }),
    freshCtx(log, entries, { model: MODEL }),
  )

  assert.deepEqual(log.sequence, ["consume"])
  assert.deepEqual(log.levels, [])
  assert.match(log.notifies.join(" "), /No API key for anthropic\/planning-model/u)
})

test("a failing model switch degrades to the session default", async () => {
  const log = handoffLog()
  const entries = stateEntry({ mode: "default", modelInfo: MODEL_INFO })

  await applyModelInfo(
    freshPi(log, { modelError: "boom" }),
    freshCtx(log, entries, { model: MODEL }),
  )

  assert.deepEqual(log.sequence, ["consume"])
  assert.deepEqual(log.levels, [])
  assert.match(log.notifies.join(" "), /boom/u)
})

test("a model unavailable in the fresh session degrades to the session default", async () => {
  const log = handoffLog()
  const entries = stateEntry({ mode: "default", modelInfo: MODEL_INFO })

  await applyModelInfo(freshPi(log), freshCtx(log, entries))

  assert.deepEqual(log.sequence, ["consume"])
  assert.deepEqual(log.models, [])
  assert.deepEqual(log.levels, [])
  assert.match(log.notifies.join(" "), /anthropic\/planning-model is no longer available/u)
})

test("without model info applyModelInfo applies and persists nothing", async () => {
  const log = handoffLog()
  await applyModelInfo(freshPi(log), freshCtx(log, stateEntry({ mode: "planning", plan: PLAN })))
  await applyModelInfo(freshPi(log), freshCtx(log, []))

  assert.deepEqual(log.sequence, [])
  assert.deepEqual(log.entries, [])
})

test("a newer plan-mode entry shadows the model info, retiring it without consuming", async () => {
  const log = handoffLog()
  const shadowed = [
    ...stateEntry({ mode: "default", modelInfo: MODEL_INFO }),
    ...stateEntry({ mode: "planning", plan: PLAN }),
  ]

  await applyModelInfo(freshPi(log), freshCtx(log, shadowed, { model: MODEL }))

  assert.deepEqual(log.sequence, [])
  assert.deepEqual(log.entries, [])
})
