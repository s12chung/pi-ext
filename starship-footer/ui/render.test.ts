import assert from "node:assert/strict"
import { test } from "node:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@earendil-works/pi-tui"
import { type FooterRowParts, composeFooterRow, fitStatusTexts, renderFooterRow } from "./render.ts"

// pi's truncateToWidth appends ANSI reset sequences on truncation, so
// truncated rows are compared by their visible content
const visible = (text: string): string => stripVTControlCharacters(text)

const parts = (overrides: Partial<FooterRowParts> = {}): FooterRowParts => ({
  left: ["left"],
  right: ["right"],
  separator: " | ",
  statuses: [],
  ...overrides,
})

test("fitStatusTexts keeps whole statuses while they fit", () => {
  assert.equal(fitStatusTexts(["ab", "cd", "ef"], 100, " | "), "ab | cd | ef")
  assert.equal(fitStatusTexts(["ab", "cd", "ef"], 9, " | "), "ab | cd")
  assert.equal(fitStatusTexts(["ab", "cd", "ef"], 0, " | "), "")
  assert.equal(fitStatusTexts([], 10, " | "), "")
})

test("fitStatusTexts truncates a lone status and drops empties", () => {
  assert.equal(visible(fitStatusTexts(["abcdef"], 4, " | ")), "abc…")
  assert.equal(fitStatusTexts(["abcdef"], 1, " | "), "")
  assert.equal(fitStatusTexts(["", "ab"], 10, " | "), "ab")
})

test("composeFooterRow justifies left and right inside the width", () => {
  const row = composeFooterRow("left", "right", [], " | ", 20)
  assert.equal(row, `left${" ".repeat(11)}right`)
  assert.equal(visibleWidth(row), 20)
})

test("composeFooterRow prepends statuses before the right side", () => {
  const row = composeFooterRow("left", "right", ["s1", "s2"], " | ", 24)
  assert.equal(row, `left${" ".repeat(5)}s1 | s2 | right`)
})

test("composeFooterRow drops statuses that cannot fit", () => {
  assert.equal(composeFooterRow("left", "right", ["s1"], " | ", 11), "left  right")
  // The lone status still truncates when the right side is empty
  assert.equal(visible(composeFooterRow("left", "", ["toolong"], " | ", 8)), "lefttoo…")
})

test("composeFooterRow drops the right side and truncates left on overflow", () => {
  assert.equal(composeFooterRow("leftish", "right", [], " | ", 7), "leftish")
  assert.equal(visible(composeFooterRow("leftish", "right", [], " | ", 6)), "leftis")
  // One row shorter still joins when exactly one gap fits
  assert.equal(composeFooterRow("le", "ri", [], " | ", 5), "le ri")
})

test("composeFooterRow frames nothing itself and tolerates the one-cell row", () => {
  assert.equal(composeFooterRow("", "", ["a"], " | ", 1), "a")
  assert.equal(composeFooterRow("x", "", [], " | ", 1), "x")
})

test("renderFooterRow frames and justifies the parts inside the width", () => {
  const [row] = renderFooterRow(22, parts())
  assert.equal(row, ` left${" ".repeat(11)}right `)
  assert.equal(visibleWidth(row), 22)
})

test("renderFooterRow squeezes statuses into the gap before the right side", () => {
  const [row] = renderFooterRow(26, parts({ statuses: ["s1", "s2"] }))
  assert.equal(row, ` left${" ".repeat(5)}s1 | s2 | right `)
  assert.equal(visibleWidth(row), 26)
})

test("renderFooterRow truncates overflow and returns an empty row at width 0", () => {
  const [overflow] = renderFooterRow(6, parts({ left: ["leftish"], right: ["right"] }))
  assert.equal(visible(overflow ?? ""), " left ")
  assert.deepEqual(renderFooterRow(0, parts()), [""])
})
