/**
 * State and label resolution for the starship footer - how raw strings and
 * numbers become display text. Faithful ports of zentui's state/format/icons
 * layers for one fixed setup (segments cwd, sessionName, gitBranch |
 * modelInfo, context, cost); the color specs live in color.ts and the layout
 * and pi wiring live in index.ts.
 */

import { stripVTControlCharacters } from "node:util"
import { type ContextColorTier, EDITOR_COLORS, type ThemeLike, footerColor } from "./color.ts"
import type { ContextSnapshot, ModelInfo, ThinkingLevel } from "./decoder.ts"

// zentui's contextThresholds defaults
const CONTEXT_WARNING_THRESHOLD = 70
const CONTEXT_ERROR_THRESHOLD = 90

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

// The model-info segment, styled like the editor's metadata (zentui
// editor-metadata-format.ts renderVariable): the model id in the editor's
// accent, the pretty provider in plain text - dropped when the provider
// already appears inside the id (zentui composeModelInfoLabel) - and the
// thinking level beside them in the editor's muted, hidden at "off"
export function modelInfoSegment(
  theme: ThemeLike,
  model: ModelInfo,
  thinkingLevel: ThinkingLevel | undefined,
): string {
  const id = sanitizeFooterText(model.id ?? "") || "no-model"
  const provider = sanitizeFooterText(providerLabel(model.provider))
  const normalizedId = normalizeModelInfoPart(id)
  const normalizedProvider = normalizeModelInfoPart(provider)
  const providerIsDuplicated =
    normalizedProvider.length > 0 && normalizedId.includes(normalizedProvider)
  const thinking = thinkingLabel(thinkingLevel)
  return [
    footerColor(theme, EDITOR_COLORS.model, id),
    providerIsDuplicated ? "" : footerColor(theme, EDITOR_COLORS.provider, provider),
    thinking === "" ? "" : footerColor(theme, EDITOR_COLORS.thinking, thinking),
  ]
    .filter(Boolean)
    .join(" ")
}

// The editor hides the thinking label at "off" (zentui renderVariable's
// thinking = values.thinking.toLowerCase() === "off" ? "" : ...)
function thinkingLabel(level: ThinkingLevel | undefined): string {
  if (level === undefined || level === "off") return ""
  return level
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

export function contextTier(percent: number | undefined): ContextColorTier {
  if (percent === undefined || !Number.isFinite(percent)) return "normal"
  if (percent >= CONTEXT_ERROR_THRESHOLD) return "error"
  if (percent >= CONTEXT_WARNING_THRESHOLD) return "warning"
  return "normal"
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

export type IconEnvironment = Readonly<Record<string, string | undefined>>

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
