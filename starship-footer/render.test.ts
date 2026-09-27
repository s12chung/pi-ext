import assert from "node:assert/strict"
import { test } from "node:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@earendil-works/pi-tui"
import type { ThemeLike } from "./color.ts"
import { type FooterSource, composeFooterRow, fitStatusTexts, renderFooter } from "./render.ts"

// pi's truncateToWidth appends ANSI reset sequences on truncation, so
// truncated rows are compared by their visible content
const visible = (text: string): string => stripVTControlCharacters(text)

// A fake theme emitting real ANSI so pi-tui's visibleWidth sees only the
// text (marker strings would count as visible cells and skew the layout);
// the fg/bold doubles double as expectation builders
const ROLE_CODES: Record<string, string> = {
  accent: "45",
  text: "255",
  syntaxFunction: "81",
  success: "71",
  syntaxKeyword: "135",
  muted: "245",
  warning: "214",
  error: "196",
  mdHeading: "39",
}
const fg = (color: string, text: string): string =>
  `\u001B[38;5;${ROLE_CODES[color] ?? "250"}m${text}\u001B[39m`
const bold = (text: string): string => `\u001B[1m${text}\u001B[22m`
const theme: ThemeLike = { fg, bold }

const source = (overrides: Partial<FooterSource> = {}): FooterSource => ({
  cwd: "/home/user/pi-ext",
  sessionName: "footer work",
  branch: "main",
  model: { id: "sonnet-4-5", provider: "anthropic", contextWindow: 200_000 },
  contextUsage: { percent: 6.2, contextWindow: 200_000 },
  entries: [],
  thinkingLevel: "off",
  statuses: new Map<string, string>(),
  ...overrides,
})

const LEFT = `${fg("syntaxFunction", bold("pi-ext"))} in ${fg("success", bold("footer work"))} on ${fg("syntaxKeyword", bold("* main"))}`
const MODEL_INFO = `${fg("accent", "sonnet-4-5")} ${fg("text", "Anthropic")}`
const RIGHT = `${MODEL_INFO}${fg("muted", " | ")}${fg("muted", "6.2%/200k")}${fg("muted", " | ")}${fg("syntaxFunction", "$0.000")}`

// Split a framed row at its justify gap (the only place with consecutive
// spaces): the head is the left side, the tail the statuses plus right side
const splitAtGap = (row: string): [string, string] => {
  const match = row.slice(1, -1).match(/^(.*?) {2,}(.*)$/u)
  assert.ok(match !== null, `expected a justify gap in ${JSON.stringify(row)}`)
  return [match[1] ?? "", match[2] ?? ""]
}

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

test("renderFooter lays out every segment with its fixed color", () => {
  const [row] = renderFooter(100, theme, source())
  const [head, tail] = splitAtGap(row)
  assert.equal(head, LEFT)
  assert.equal(tail, RIGHT)
  assert.equal(visibleWidth(row), 100)
})

test("renderFooter omits missing left segments and unknown model info", () => {
  const [row] = renderFooter(
    100,
    theme,
    source({
      sessionName: undefined,
      branch: undefined,
      model: "garbage",
      contextUsage: undefined,
    }),
  )
  const [head, tail] = splitAtGap(row)
  assert.equal(head, fg("syntaxFunction", bold("pi-ext")))
  assert.equal(
    tail,
    `${fg("accent", "no-model")} ${fg("text", "Unknown")}${fg("muted", " | ")}${fg("muted", "--")}${fg("muted", " | ")}${fg("syntaxFunction", "$0.000")}`,
  )
})

test("renderFooter shows the thinking level beside the model in the editor's muted", () => {
  const [row] = renderFooter(100, theme, source({ thinkingLevel: "high" }))
  const [head, tail] = splitAtGap(row)
  assert.equal(head, LEFT)
  assert.equal(
    tail,
    `${MODEL_INFO} ${fg("muted", "high")}${fg("muted", " | ")}${fg("muted", "6.2%/200k")}${fg("muted", " | ")}${fg("syntaxFunction", "$0.000")}`,
  )
})

test("renderFooter sorts, sanitizes, and prepends extension statuses", () => {
  const statuses = new Map([
    ["plan-mode", "\u001B[31m⏸ plan\u001B[0m"],
    ["lint", "ok"],
  ])
  const [row] = renderFooter(100, theme, source({ statuses }))
  const [head, tail] = splitAtGap(row)
  assert.equal(head, LEFT)
  assert.equal(
    tail,
    `${fg("mdHeading", "ok")}${fg("muted", " | ")}${fg("mdHeading", "⏸ plan")}${fg("muted", " | ")}${RIGHT}`,
  )
})

test("renderFooter tiers the context color at the thresholds", () => {
  const warning = renderFooter(100, theme, source({ contextUsage: { percent: 75 } }))
  assert.ok(warning[0]?.includes(fg("warning", bold("75.0%/200k"))))
  const error = renderFooter(100, theme, source({ contextUsage: { percent: 95 } }))
  assert.ok(error[0]?.includes(fg("error", bold("95.0%/200k"))))
})

test("renderFooter returns one framed row that fits the width", () => {
  const rows = renderFooter(30, theme, source())
  assert.equal(rows.length, 1)
  assert.equal(visibleWidth(rows[0]), 30)
  assert.ok(rows[0]?.startsWith(" ") && rows[0]?.endsWith(" "))
  assert.deepEqual(renderFooter(0, theme, source()), [""])
})
