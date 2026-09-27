import assert from "node:assert/strict"
import { test } from "node:test"
import {
  type FooterSource,
  contextLabel,
  costLabel,
  cwdLabel,
  footerPartBuilders,
  formatCount,
  gitGlyph,
  modelInfoSegment,
  providerLabel,
  sanitizeFooterText,
  statusSegments,
} from "./state.ts"
import type { ThemeLike } from "./ui/color.ts"
import type { ContextSnapshot, ModelInfo } from "./utils/decoder.ts"

// Marker colors are fine here: no width math, just which spec styled what
const theme: ThemeLike = {
  fg: (color: string, text: string): string => `<fg:${color}>${text}</fg:${color}>`,
}

const CONTEXT = (
  percent: number | undefined,
  contextWindow: number | undefined,
): ContextSnapshot => ({
  percent,
  contextWindow,
})

const MODEL = (id: string | undefined, provider: string | undefined): ModelInfo => ({
  id,
  provider,
  contextWindow: undefined,
})

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

test("formatCount matches zentui's tiered rounding", () => {
  assert.equal(formatCount(999), "999")
  assert.equal(formatCount(1000), "1.0k")
  assert.equal(formatCount(1500), "1.5k")
  assert.equal(formatCount(9999), "10.0k")
  assert.equal(formatCount(10_000), "10k")
  assert.equal(formatCount(999_999), "1000k")
  assert.equal(formatCount(1_000_000), "1.0M")
  assert.equal(formatCount(10_000_000), "10M")
})

test("providerLabel pretty-names known providers and title-cases the rest", () => {
  assert.equal(providerLabel("anthropic"), "Anthropic")
  assert.equal(providerLabel("openai-codex"), "OpenAI")
  assert.equal(providerLabel("google"), "Google")
  assert.equal(providerLabel("my-provider"), "My Provider")
  assert.equal(providerLabel(undefined), "Unknown")
  assert.equal(providerLabel(""), "Unknown")
})

test("modelInfoSegment wears the editor's colors and dedups the provider", () => {
  assert.equal(
    modelInfoSegment(theme, MODEL(undefined, undefined)),
    "<fg:accent>no-model</fg:accent> <fg:text>Unknown</fg:text>",
  )
  assert.equal(
    modelInfoSegment(theme, MODEL("sonnet-4-5", "anthropic")),
    "<fg:accent>sonnet-4-5</fg:accent> <fg:text>Anthropic</fg:text>",
  )
  // "openaigpt5" contains "openai", so the provider is dropped
  assert.equal(
    modelInfoSegment(theme, MODEL("openai/gpt-5", "openai")),
    "<fg:accent>openai/gpt-5</fg:accent>",
  )
})

test("footerPartBuilders turns each field into its colored part", () => {
  const { cwd, sessionName, branch, model, thinkingLevel, contextUsage, cost } = footerPartBuilders
  assert.equal(cwd(theme, source()), "<fg:syntaxFunction>pi-ext</fg:syntaxFunction>")
  assert.equal(sessionName(theme, source()), "in <fg:success>footer work</fg:success>")
  assert.equal(sessionName(theme, source({ sessionName: undefined })), "")
  assert.equal(branch(theme, source()), "on <fg:syntaxKeyword>* main</fg:syntaxKeyword>")
  assert.equal(branch(theme, source({ branch: undefined })), "")
  assert.equal(
    model(theme, source()),
    "<fg:accent>sonnet-4-5</fg:accent> <fg:text>Anthropic</fg:text>",
  )
  assert.equal(thinkingLevel(theme, source()), "")
  assert.equal(thinkingLevel(theme, source({ thinkingLevel: "high" })), "<fg:muted>high</fg:muted>")
  assert.equal(contextUsage(theme, source()), "<fg:muted>6.2%/200k</fg:muted>")
  assert.equal(
    contextUsage(theme, source({ contextUsage: { percent: 95, contextWindow: 200_000 } })),
    "<fg:error>95.0%/200k</fg:error>",
  )
  assert.equal(cost(theme, source()), "<fg:syntaxFunction>$0.000</fg:syntaxFunction>")
})

test("footerPartBuilders sorts, sanitizes, and drops empty statuses", () => {
  const statuses = statusSegments(
    theme,
    new Map([
      ["plan-mode", "\u001B[31m⏸ plan\u001B[0m"],
      ["lint", ""],
    ]),
  )
  assert.deepEqual(statuses, ["<fg:mdHeading>⏸ plan</fg:mdHeading>"])
})

test("contextLabel renders --, ?, and clamped percentages", () => {
  assert.equal(contextLabel(CONTEXT(undefined, undefined)), "--")
  assert.equal(contextLabel(CONTEXT(undefined, 0)), "--")
  assert.equal(contextLabel(CONTEXT(undefined, 200_000)), "?/200k")
  assert.equal(contextLabel(CONTEXT(12.34, 200_000)), "12.3%/200k")
  assert.equal(contextLabel(CONTEXT(1234, 200_000)), "999.0%/200k")
})

test("costLabel renders dollars to three decimals", () => {
  assert.equal(costLabel(0), "$0.000")
  assert.equal(costLabel(1.23456), "$1.235")
})

test("cwdLabel shows the basename with normalized separators", () => {
  assert.equal(cwdLabel("/home/user/pi-ext"), "pi-ext")
  assert.equal(cwdLabel("/home/user/pi-ext/"), "pi-ext")
  assert.equal(cwdLabel("C:\\repo\\app"), "app")
  assert.equal(cwdLabel("/"), "/")
})

test("sanitizeFooterText strips escapes, controls, and collapses whitespace", () => {
  assert.equal(sanitizeFooterText("\u001B[31mred\u001B[0m"), "red")
  assert.equal(sanitizeFooterText("a\r\nb\tc\u0007"), "a b c")
  assert.equal(sanitizeFooterText("  padded  "), "padded")
  assert.equal(sanitizeFooterText("\u001B]8;;https://x\u0007link\u001B]8;;\u0007"), "link")
})

test("gitGlyph follows zentui's auto icon detection", () => {
  assert.equal(gitGlyph({}), "*")
  assert.equal(gitGlyph({ TERM_PROGRAM: "iTerm.app" }), "")
  assert.equal(gitGlyph({ TERM_PROGRAM: "ghostty" }), "")
  assert.equal(gitGlyph({ KITTY_WINDOW_ID: "1" }), "")
  assert.equal(gitGlyph({ ALACRITTY_SOCKET: "/tmp/a.sock" }), "")
  assert.equal(gitGlyph({ ZENTUI_NERD_FONTS: "1" }), "")
  assert.equal(gitGlyph({ ZENTUI_NERD_FONTS: "0", TERM_PROGRAM: "iTerm.app" }), "*")
})
