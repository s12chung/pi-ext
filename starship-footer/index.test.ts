import assert from "node:assert/strict"
import { test } from "node:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import { footerParts } from "./index.ts"
import type { FooterSource } from "./state.ts"
import type { ThemeLike } from "./ui/color.ts"
import { renderFooterRow } from "./ui/render.ts"

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
  cost: 0,
  thinkingLevel: "off",
  statuses: new Map<string, string>(),
  ...overrides,
})

const renderRow = (width: number, rowSource: FooterSource): string => {
  const [row] = renderFooterRow(width, footerParts(theme, rowSource))
  return row ?? ""
}

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

test("footerParts lays out every segment with its fixed color", () => {
  const [head, tail] = splitAtGap(renderRow(100, source()))
  assert.equal(head, LEFT)
  assert.equal(tail, RIGHT)
})

test("footerParts omits missing left segments and unknown model info", () => {
  const [head, tail] = splitAtGap(
    renderRow(
      100,
      source({
        sessionName: undefined,
        branch: undefined,
        model: { id: undefined, provider: undefined, contextWindow: undefined },
        contextUsage: { percent: undefined, contextWindow: undefined },
      }),
    ),
  )
  assert.equal(head, fg("syntaxFunction", bold("pi-ext")))
  assert.equal(
    tail,
    `${fg("accent", "no-model")} ${fg("text", "Unknown")}${fg("muted", " | ")}${fg("muted", "--")}${fg("muted", " | ")}${fg("syntaxFunction", "$0.000")}`,
  )
})

test("footerParts shows the thinking level beside the model in the editor's muted", () => {
  const [head, tail] = splitAtGap(renderRow(100, source({ thinkingLevel: "high" })))
  assert.equal(head, LEFT)
  assert.equal(
    tail,
    `${MODEL_INFO} ${fg("muted", "high")}${fg("muted", " | ")}${fg("muted", "6.2%/200k")}${fg("muted", " | ")}${fg("syntaxFunction", "$0.000")}`,
  )
})

test("footerParts sorts, sanitizes, and prepends extension statuses", () => {
  const statuses = new Map([
    ["plan-mode", "\u001B[31m⏸ plan\u001B[0m"],
    ["lint", "ok"],
  ])
  const [head, tail] = splitAtGap(renderRow(100, source({ statuses })))
  assert.equal(head, LEFT)
  assert.equal(
    tail,
    `${fg("mdHeading", "ok")}${fg("muted", " | ")}${fg("mdHeading", "⏸ plan")}${fg("muted", " | ")}${RIGHT}`,
  )
})

test("footerParts tiers the context color at the thresholds", () => {
  const warning = renderRow(100, source({ contextUsage: { percent: 75, contextWindow: 200_000 } }))
  assert.ok(warning.includes(fg("warning", bold("75.0%/200k"))))
  const error = renderRow(100, source({ contextUsage: { percent: 95, contextWindow: 200_000 } }))
  assert.ok(error.includes(fg("error", bold("95.0%/200k"))))
})

test("the composed row is one framed row that fits the width", () => {
  const row = renderRow(30, source())
  assert.equal(visibleWidth(row), 30)
  assert.ok(row.startsWith(" ") && row.endsWith(" "))
  assert.equal(renderRow(0, source()), "")
})
