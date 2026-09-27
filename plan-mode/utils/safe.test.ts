import assert from "node:assert/strict"
import { test } from "node:test"
import { bestEffort, errorIncludes, safeErrorDetail } from "./safe.ts"

test("errorIncludes matches any fragment in a real Error's message", () => {
  assert.equal(errorIncludes(new Error("ctx is stale after reload"), ["stale after reload"]), true)
  assert.equal(errorIncludes(new Error("unrelated"), ["stale", "no longer active"]), false)
  assert.equal(errorIncludes("stale after reload", ["stale after reload"]), false)
  assert.equal(errorIncludes(new Error("any"), []), false)
})

test("bestEffort reports whether the operation landed", () => {
  assert.equal(
    bestEffort(() => undefined),
    true,
  )
  assert.equal(
    bestEffort(() => {
      throw new Error("stale context")
    }),
    false,
  )
})

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (safeErrorDetail)
test("safeErrorDetail flattens multiline errors and collapses whitespace", () => {
  assert.equal(safeErrorDetail(new Error("line one\n  line\ttwo")), "line one line two")
})

test("safeErrorDetail replaces control characters and bidi overrides with spaces", () => {
  assert.equal(safeErrorDetail(new Error("bad\u0000name\u007F\u202Eevil")), "bad name evil")
})

test("safeErrorDetail stringifies non-errors and defaults when blank", () => {
  assert.equal(safeErrorDetail(42), "42")
  assert.equal(safeErrorDetail(new Error(" \u0000 ")), "unknown error")
})

test("safeErrorDetail truncates to 500 characters", () => {
  const detail = safeErrorDetail(new Error("a".repeat(600)))
  assert.equal([...detail].length, 500)
  assert.ok(detail.endsWith("…"))
})
