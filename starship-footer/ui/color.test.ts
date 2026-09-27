import assert from "node:assert/strict"
import { test } from "node:test"
import { COLORS, type ThemeLike, colorize, dynaPercentColor, footerSeparator } from "./color.ts"

// A recording fake theme: fg wraps in markers so call order and color are
// visible; bold nests inside the color wrap
function fakeTheme(): ThemeLike {
  return {
    fg: (color: string, text: string): string => `<fg:${color}>${text}</fg:${color}>`,
    bold: (text: string): string => `<b>${text}</b>`,
  }
}

test("dynaPercentColor tiers the context color at zentui's 70/90 thresholds", () => {
  const percents: (number | undefined)[] = [undefined, Number.NaN, 69.9, 70, 89.9, 90]
  assert.deepEqual(
    percents.map((percent) => dynaPercentColor(percent)),
    [
      COLORS.contextNormal,
      COLORS.contextNormal,
      COLORS.contextNormal,
      COLORS.contextWarning,
      COLORS.contextWarning,
      COLORS.contextError,
    ],
  )
})

test("colorize maps specs through the theme with modifiers inside the color", () => {
  const theme = fakeTheme()
  // bold cyan -> syntaxFunction role, bold nested inside fg
  assert.equal(
    colorize(theme, COLORS.cwd, "dir"),
    "<fg:syntaxFunction><b>dir</b></fg:syntaxFunction>",
  )
  // dimmed cyan -> "dimmed" only supplies a fallback role, so plain syntaxFunction
  assert.equal(colorize(theme, COLORS.cost, "$1"), "<fg:syntaxFunction>$1</fg:syntaxFunction>")
  // theme roles pass through untouched
  assert.equal(colorize(theme, COLORS.extensionStatus, "s"), "<fg:mdHeading>s</fg:mdHeading>")
  assert.equal(colorize(theme, COLORS.separator, " | "), "<fg:muted> | </fg:muted>")
  assert.equal(
    colorize(theme, COLORS.gitBranch, "main"),
    "<fg:syntaxKeyword><b>main</b></fg:syntaxKeyword>",
  )
})

test("colorize fails open on empty specs and invalid theme roles", () => {
  const theme = fakeTheme()
  assert.equal(colorize(theme, "", "plain"), "plain")
  const throwing: ThemeLike = {
    fg: (_color: string, _text: string): string => {
      throw new Error("bad role")
    },
  }
  assert.equal(colorize(throwing, COLORS.cwd, "text"), "text")
})

test("footerSeparator colors the fixed separator text", () => {
  assert.equal(footerSeparator(fakeTheme()), "<fg:muted> | </fg:muted>")
})
