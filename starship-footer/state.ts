/**
 * State and label resolution for the starship footer - the footer's state
 * shape (FooterSource, collected and decoded from pi by index.ts) and how
 * each field of it becomes display text: one already-colored part builder per
 * field (FooterPartBuilders) over the label helpers. Faithful ports of
 * zentui's state/format/icons layers for one fixed setup (parts cwd,
 * sessionName, gitBranch | model, thinkingLevel, context, cost); the coloring
 * lives in ui/color.ts, the layout in ui/render.ts, and the pi wiring in
 * index.ts.
 */

import { stripVTControlCharacters } from "node:util"
import { COLORS, type ThemeLike, colorize, dynaPercentColor } from "./ui/color.ts"
import type { ContextSnapshot, ModelInfo, ThinkingLevel } from "./utils/decoder.ts"

// Everything the footer renders from, collected per render into one bundle:
// index.ts reads pi and vets its weakly typed data through utils/decoder.ts
export interface FooterSource {
  cwd: string
  sessionName: string | undefined
  branch: string | undefined
  model: ModelInfo
  contextUsage: ContextSnapshot
  cost: number
  thinkingLevel: ThinkingLevel | undefined
  statuses: ReadonlyMap<string, string>
}

// One part builder per FooterSource field: each turns the field's vetted data
// into the already-colored part string(s) it contributes to the row;
// index.ts's footerParts decides the joining and the order
type FooterPartBuilders = {
  cwd(theme: ThemeLike, source: FooterSource): string
  sessionName(theme: ThemeLike, source: FooterSource): string
  branch(theme: ThemeLike, source: FooterSource): string
  model(theme: ThemeLike, source: FooterSource): string
  thinkingLevel(theme: ThemeLike, source: FooterSource): string
  contextUsage(theme: ThemeLike, source: FooterSource): string
  cost(theme: ThemeLike, source: FooterSource): string
  statuses(theme: ThemeLike, source: FooterSource): string[]
}

export const footerPartBuilders: FooterPartBuilders = {
  cwd: (theme, source) => colorize(theme, COLORS.cwd, cwdLabel(source.cwd)),
  // "in {name}", dropped for a nameless session
  sessionName: (theme, source) => {
    const sessionName = sanitizeFooterText(source.sessionName ?? "")
    if (sessionName === "") return ""
    return `in ${colorize(theme, COLORS.sessionName, sessionName)}`
  },
  // "on {icon} {branch}" with the git glyph sharing the branch color
  branch: (theme, source) => {
    const branch = sanitizeFooterText(source.branch ?? "")
    if (branch === "") return ""
    return `on ${colorize(theme, COLORS.gitBranch, `${gitGlyph()} ${branch}`.trim())}`
  },
  model: (theme, source) => modelInfoSegment(theme, source.model),
  // The editor's muted, hidden at "off" (zentui renderVariable's thinking =
  // values.thinking.toLowerCase() === "off" ? "" : ...)
  thinkingLevel: (theme, source) => {
    const level = source.thinkingLevel
    if (level === undefined || level === "off") return ""
    return colorize(theme, COLORS.thinking, level)
  },
  contextUsage: (theme, source) =>
    colorize(
      theme,
      dynaPercentColor(source.contextUsage.percent),
      contextLabel(source.contextUsage),
    ),
  // The session cost, "dimmed cyan"
  cost: (theme, source) => colorize(theme, COLORS.cost, costLabel(source.cost)),
  statuses: (theme, source) => statusSegments(theme, source.statuses),
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  gemini: "Google",
  google: "Google",
  ollama: "Ollama",
  openai: "OpenAI",
  "openai-codex": "OpenAI",
}

// zentui formatCount's tiered rounding: 999 -> "999", 1500 -> "1.5k",
// 15_000 -> "15k", 1_500_000 -> "1.5M"
export function formatCount(value: number): string {
  if (value < 1000) return value.toString()
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`
  if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  return `${Math.round(value / 1_000_000)}M`
}

export function providerLabel(provider: string | undefined): string {
  if (provider === undefined || provider === "") return "Unknown"
  return (
    PROVIDER_LABELS[provider] ??
    provider.replaceAll(/[-_]/gu, " ").replaceAll(/\b\w/gu, (char) => char.toUpperCase())
  )
}

// The editor-style model metadata (zentui editor-metadata-format.ts
// renderVariable): the model id in the editor's accent, the pretty provider
// in plain text - dropped when the provider already appears inside the id
// (zentui composeModelInfoLabel)
export function modelInfoSegment(theme: ThemeLike, model: ModelInfo): string {
  const id = sanitizeFooterText(model.id ?? "") || "no-model"
  const provider = sanitizeFooterText(providerLabel(model.provider))
  const normalizedId = normalizeModelInfoPart(id)
  const normalizedProvider = normalizeModelInfoPart(provider)
  const providerIsDuplicated =
    normalizedProvider.length > 0 && normalizedId.includes(normalizedProvider)
  return [
    colorize(theme, COLORS.model, id),
    providerIsDuplicated ? "" : colorize(theme, COLORS.provider, provider),
  ]
    .filter(Boolean)
    .join(" ")
}

function normalizeModelInfoPart(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "")
}

// "--" without a window, "?/200k" before the first response, then "12.3%/200k"
// (zentui formatContextPercentLabel)
export function contextLabel(context: ContextSnapshot): string {
  const window = context.contextWindow
  if (window === undefined || window <= 0) return "--"
  return `${formatContextPercent(context.percent)}/${formatCount(window)}`
}

function formatContextPercent(percent: number | undefined): string {
  if (percent === undefined || !Number.isFinite(percent)) return "?"
  return `${Math.max(0, Math.min(999, percent)).toFixed(1)}%`
}

export function costLabel(cost: number): string {
  return `$${cost.toFixed(3)}`
}

// The cwd segment shows the basename (zentui formatCwdLabel, pathDisplay
// "basename"): backslashes normalized, trailing slashes stripped, root "/"
export function cwdLabel(cwd: string): string {
  const normalized = normalizeDisplayPath(cwd)
  const parts = normalized.split("/").filter(Boolean)
  return sanitizeFooterText(parts.at(-1) ?? cwd)
}

function normalizeDisplayPath(cwd: string): string {
  const withSlashes = cwd.replaceAll("\\", "/")
  if (withSlashes === "/" || /^\/+$/u.test(withSlashes)) return "/"
  const stripped = withSlashes.replace(/\/+$/u, "")
  return stripped === "" ? withSlashes : stripped
}

// Single-line-safe text: escape sequences stripped, control characters
// removed, whitespace runs collapsed to one space (zentui
// sanitizeExtensionStatusText)
export function sanitizeFooterText(text: string): string {
  return (
    stripVTControlCharacters(text)
      .replaceAll(/[\r\n\t\f\v]+/gu, " ")
      // oxlint-disable-next-line no-control-regex -- stripping control characters is this line's purpose
      .replaceAll(/[\u0000-\u001F\u007F-\u009F]/gu, "")
      .replaceAll(/\s+/gu, " ")
      .trim()
  )
}

// Extension statuses sorted by key, single-line-safe, each in the extension
// status color; empty texts drop out
export function statusSegments(theme: ThemeLike, statuses: ReadonlyMap<string, string>): string[] {
  return [...statuses.entries()]
    .toSorted(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0))
    .flatMap(([, text]) => {
      const sanitized = sanitizeFooterText(text)
      return sanitized === "" ? [] : [colorize(theme, COLORS.extensionStatus, sanitized)]
    })
}

type IconEnvironment = Readonly<Record<string, string | undefined>>

// zentui's auto icon mode: Nerd glyphs for terminals that signal support,
// ASCII otherwise, with ZENTUI_NERD_FONTS forcing the choice. Only the git
// glyph is displayed in this setup
export function gitGlyph(env: IconEnvironment = process.env): string {
  return effectiveIconMode(env) === "ascii" ? "*" : ""
}

function effectiveIconMode(env: IconEnvironment): "nerd" | "ascii" {
  if (env.ZENTUI_NERD_FONTS === "1") return "nerd"
  if (env.ZENTUI_NERD_FONTS === "0") return "ascii"
  const termProgram = env.TERM_PROGRAM?.toLowerCase()
  if (termProgram === "iterm.app" || termProgram === "wezterm" || termProgram === "ghostty") {
    return "nerd"
  }
  if (env.KITTY_WINDOW_ID?.trim() || env.ALACRITTY_SOCKET?.trim()) return "nerd"
  return "ascii"
}
