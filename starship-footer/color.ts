/**
 * Color resolution for the starship footer: the fixed segment specs and how
 * each renders through pi's theme - a faithful port of zentui's style layer
 * (renderThemeStyle). state.ts decides which text and tier to show; this
 * module only turns specs into colored text.
 */

export const FOOTER_COLORS = {
  cwd: "bold cyan",
  sessionName: "bold green",
  gitBranch: "bold purple",
  contextNormal: "bright-black",
  contextWarning: "bold yellow",
  contextError: "bold red",
  cost: "dimmed cyan",
  separator: "bright-black",
  extensionStatus: "mdHeading",
} as const

export type ContextColorTier = "normal" | "warning" | "error"

// The editor's metadata colors, used by the footer's model-info segment so the
// two read identically. Ported from zentui's editor defaults
// (editor-metadata-format.ts renderVariable): the model falls back to the
// theme accent (EDITOR_ACCENT_FALLBACK), the provider to plain text, and the
// thinking level through its per-level chain, which has no configured colors
// by default and so collapses to the final "muted" fallback for every level
export const EDITOR_COLORS = {
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

export function contextColorSpec(tier: ContextColorTier): string {
  if (tier === "error") return FOOTER_COLORS.contextError
  if (tier === "warning") return FOOTER_COLORS.contextWarning
  return FOOTER_COLORS.contextNormal
}

// Colorize text with a Starship-style spec ("bold cyan", "dimmed cyan",
// "mdHeading") through pi's theme - zentui's renderThemeStyle: the first
// color token maps to a theme role (cyan -> syntaxFunction, green -> success,
// purple -> syntaxKeyword, bright-black -> muted, ...), bold/italic/underline
// wrap the text inside the color, "dim"/"dimmed" only supply a fallback role,
// and an unmapped token is passed to theme.fg unchanged. Invalid tokens fail
// open to plain text, so a bad spec never breaks rendering
export function footerColor(theme: ThemeLike, spec: string, text: string): string {
  const trimmed = spec.trim()
  if (trimmed === "") return text
  const tokens = trimmed.split(/\s+/u).filter(Boolean)
  const color = mapThemeColor(tokens) ?? "text"
  return safeThemeFg(theme, color, applyThemeModifiers(theme, tokens, text))
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
