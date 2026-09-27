import assert from "node:assert/strict"
import { test } from "node:test"
import {
  type ContextColorTier,
  FOOTER_COLORS,
  type ThemeLike,
  contextColorSpec,
  footerColor,
} from "./color.ts"

// A recording fake theme: fg wraps in markers so call order and color are
// visible; bold nests inside the color wrap
function fakeTheme(): ThemeLike {
  return {
    fg: (color: string, text: string): string => `<fg:${color}>${text}</fg:${color}>`,
    bold: (text: string): string => `<b>${text}</b>`,
  }
}

test("contextColorSpec maps tiers to their fixed specs", () => {
  const tiers: ContextColorTier[] = ["normal", "warning", "error"]
  assert.deepEqual(
    tiers.map((tier) => contextColorSpec(tier)),
    [FOOTER_COLORS.contextNormal, FOOTER_COLORS.contextWarning, FOOTER_COLORS.contextError],
  )
})

test("footerColor maps specs through the theme with modifiers inside the color", () => {
  const theme = fakeTheme()
  // bold cyan -> syntaxFunction role, bold nested inside fg
  assert.equal(
    footerColor(theme, FOOTER_COLORS.cwd, "dir"),
    "<fg:syntaxFunction><b>dir</b></fg:syntaxFunction>",
  )
  // dimmed cyan -> "dimmed" only supplies a fallback role, so plain syntaxFunction
  assert.equal(
    footerColor(theme, FOOTER_COLORS.cost, "$1"),
    "<fg:syntaxFunction>$1</fg:syntaxFunction>",
  )
  // theme roles pass through untouched
  assert.equal(
    footerColor(theme, FOOTER_COLORS.extensionStatus, "s"),
    "<fg:mdHeading>s</fg:mdHeading>",
  )
  assert.equal(footerColor(theme, FOOTER_COLORS.separator, " | "), "<fg:muted> | </fg:muted>")
  assert.equal(
    footerColor(theme, FOOTER_COLORS.gitBranch, "main"),
    "<fg:syntaxKeyword><b>main</b></fg:syntaxKeyword>",
  )
})

test("footerColor fails open on empty specs and invalid theme roles", () => {
  const theme = fakeTheme()
  assert.equal(footerColor(theme, "", "plain"), "plain")
  const throwing: ThemeLike = {
    fg: (_color: string, _text: string): string => {
      throw new Error("bad role")
    },
  }
  assert.equal(footerColor(throwing, FOOTER_COLORS.cwd, "text"), "text")
})
