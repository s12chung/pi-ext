/**
 * Color resolution for the starship footer: the fixed segment specs, the
 * context thresholds, and how specs render through pi's theme - a faithful
 * port of zentui's style layer (renderThemeStyle). state.ts decides which
 * text to show; this module turns it colored.
 */

export const COLORS = {
  // The footer's segment specs, ported from zentui's style layer
  cwd: "bold cyan",
  sessionName: "bold green",
  gitBranch: "bold purple",
  contextNormal: "bright-black",
  contextWarning: "bold yellow",
  contextError: "bold red",
  cost: "dimmed cyan",
  separator: "bright-black",
  extensionStatus: "mdHeading",

  // The editor's metadata colors, used by the footer's model-info segment so
  // the two read identically. Ported from zentui's editor defaults
  // (editor-metadata-format.ts renderVariable): the model falls back to the
  // theme accent (EDITOR_ACCENT_FALLBACK), the provider to plain text, and
  // the thinking level through its per-level chain, which has no configured
  // colors by default and so collapses to the final "muted" fallback for
  // every level
  model: "accent",
  provider: "text",
  thinking: "muted",
} as const

export interface ThemeLike {
  fg(color: string, text: string): string
  bold?(text: string): string
  italic?(text: string): string
  underline?(text: string): string
}

// zentui's contextThresholds defaults
const CONTEXT_WARNING_THRESHOLD = 70
const CONTEXT_ERROR_THRESHOLD = 90

// Which spec the context usage earns through those thresholds; undefined or
// non-finite percents read normal
export function dynaPercentColor(percent: number | undefined): string {
  if (percent === undefined || !Number.isFinite(percent)) return COLORS.contextNormal
  if (percent >= CONTEXT_ERROR_THRESHOLD) return COLORS.contextError
  if (percent >= CONTEXT_WARNING_THRESHOLD) return COLORS.contextWarning
  return COLORS.contextNormal
}

// Colorize text with a Starship-style spec ("bold cyan", "dimmed cyan",
// "mdHeading") through pi's theme - zentui's renderThemeStyle: the first
// color token maps to a theme role (cyan -> syntaxFunction, green -> success,
// purple -> syntaxKeyword, bright-black -> muted, ...), bold/italic/underline
// wrap the text inside the color, "dim"/"dimmed" only supply a fallback role,
// and an unmapped token is passed to theme.fg unchanged. Invalid tokens fail
// open to plain text, so a bad spec never breaks rendering
export function colorize(theme: ThemeLike, spec: string, text: string): string {
  const trimmed = spec.trim()
  if (trimmed === "") return text
  const tokens = trimmed.split(/\s+/u).filter(Boolean)
  const color = mapThemeColor(tokens) ?? "text"
  return safeThemeFg(theme, color, applyThemeModifiers(theme, tokens, text))
}

// The footer's " | " between the row's segments, in the separator color
export function footerSeparator(theme: ThemeLike): string {
  return colorize(theme, COLORS.separator, " | ")
}

const themeStyleModifiers = new Set(["bold", "italic", "underline"])

const themeColorNameMap = new Map([
  ["red", "error"],
  ["bright-red", "error"],
  ["green", "success"],
  ["bright-green", "success"],
  ["yellow", "warning"],
  ["bright-yellow", "warning"],
  ["blue", "syntaxFunction"],
  ["bright-blue", "syntaxFunction"],
  ["cyan", "syntaxFunction"],
  ["bright-cyan", "syntaxFunction"],
  ["purple", "syntaxKeyword"],
  ["bright-purple", "syntaxKeyword"],
  ["black", "muted"],
  ["bright-black", "muted"],
  ["white", "text"],
  ["bright-white", "text"],
])

function mapThemeColor(styleTokens: string[]): string | undefined {
  let fallback: string | undefined
  for (const token of styleTokens) {
    const normalized = token.toLowerCase()
    if (themeStyleModifiers.has(normalized)) continue
    if (normalized === "dim" || normalized === "dimmed") {
      fallback = "muted"
      continue
    }
    const mapped = themeColorNameMap.get(normalized)
    if (mapped !== undefined) return mapped
    return token
  }
  return fallback
}

function applyThemeModifiers(theme: ThemeLike, styleTokens: string[], text: string): string {
  let rendered = text
  for (const token of styleTokens) {
    const normalized = token.toLowerCase()
    if (normalized === "bold") rendered = theme.bold?.(rendered) ?? rendered
    if (normalized === "italic") rendered = theme.italic?.(rendered) ?? rendered
    if (normalized === "underline") rendered = theme.underline?.(rendered) ?? rendered
  }
  return rendered
}

function safeThemeFg(theme: ThemeLike, color: string, text: string): string {
  try {
    return theme.fg(color, text)
  } catch {
    return text
  }
}
