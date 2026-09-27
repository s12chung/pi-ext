/**
 * The starship footer renderer: zentui's single-row segment layout for one
 * fixed setup -
 *
 *   {cwd} in {session} on {branch}    {status... |} {model} {Provider} {thinkingLevel} | {ctx}%/{window} | {$cost}
 *
 * Pure over a FooterSource plus a ThemeLike, so it renders without an
 * ExtensionContext or FooterDataProvider; index.ts collects the source from
 * pi and installs the component. decoder.ts vets the source's weakly typed
 * fields; state.ts builds the labels; color.ts colors them. Overflow follows
 * zentui's non-compact path: statuses drop first, then the right side, then
 * the left side truncates - no compact reflow.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import { FOOTER_COLORS, type ThemeLike, contextColorSpec, footerColor } from "./color.ts"
import {
  type ContextSnapshot,
  decodeContextSnapshot,
  decodeModelInfo,
  decodeSessionCost,
  decodeThinkingLevel,
} from "./decoder.ts"
import {
  contextLabel,
  contextTier,
  costLabel,
  cwdLabel,
  gitGlyph,
  modelInfoSegment,
  sanitizeFooterText,
} from "./state.ts"

// Everything the footer reads from pi in one bundle, so the renderer is
// testable without an ExtensionContext or FooterDataProvider. The weakly
// typed fields (model, contextUsage, entries) stay unknown here and are
// decoded inside the render through decoder.ts
export interface FooterSource {
  cwd: string
  sessionName: string | undefined
  branch: string | undefined
  model: unknown
  contextUsage: unknown
  entries: readonly SessionEntry[]
  thinkingLevel: unknown
  statuses: ReadonlyMap<string, string>
}

export function renderFooter(width: number, theme: ThemeLike, source: FooterSource): string[] {
  if (width <= 0) return [""]
  const innerWidth = Math.max(1, width - 2)
  const model = decodeModelInfo(source.model)
  const cost = decodeSessionCost(source.entries)
  const context = decodeContextSnapshot(source.contextUsage, model.contextWindow)
  const separator = footerColor(theme, FOOTER_COLORS.separator, " | ")
  const glyph = gitGlyph()
  const left = [
    footerColor(theme, FOOTER_COLORS.cwd, cwdLabel(source.cwd)),
    sessionNameSegment(theme, source.sessionName),
    branchSegment(theme, source.branch, glyph),
  ]
    .filter(Boolean)
    .join(" ")
  // The model-info segment wears the editor's colors (accent model, text
  // provider, muted thinking level), the context segment follows its usage
  // tier, and the cost segment is "dimmed cyan"
  const right = [
    modelInfoSegment(theme, model, decodeThinkingLevel(source.thinkingLevel)),
    contextSegment(theme, context),
    footerColor(theme, FOOTER_COLORS.cost, costLabel(cost)),
  ]
    .filter(Boolean)
    .join(separator)
  const statuses = [...source.statuses.entries()]
    .toSorted(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0))
    .flatMap(([, text]): string[] => {
      const sanitized = sanitizeFooterText(text)
      if (sanitized === "") return []
      return [footerColor(theme, FOOTER_COLORS.extensionStatus, sanitized)]
    })
  const row = composeFooterRow(left, right, statuses, separator, innerWidth)
  return [frameFooterRow(row, width)]
}

function sessionNameSegment(theme: ThemeLike, name: string | undefined): string {
  if (name === undefined) return ""
  const sessionName = sanitizeFooterText(name)
  if (sessionName === "") return ""
  return `in ${footerColor(theme, FOOTER_COLORS.sessionName, sessionName)}`
}

// "on {icon} {branch}" with the git glyph sharing the branch color
function branchSegment(theme: ThemeLike, branch: string | undefined, glyph: string): string {
  if (branch === undefined) return ""
  const text = sanitizeFooterText(branch)
  if (text === "") return ""
  return `on ${footerColor(theme, FOOTER_COLORS.gitBranch, `${glyph} ${text}`.trim())}`
}

function contextSegment(theme: ThemeLike, context: ContextSnapshot): string {
  return footerColor(theme, contextColorSpec(contextTier(context.percent)), contextLabel(context))
}

// zentui's composeFooterContent for left/right zones plus right-placed
// extension statuses: when everything fits, statuses squeeze into the gap
// before the right side; when the built-ins alone overflow, the right side
// drops entirely and the left side truncates
export function composeFooterRow(
  left: string,
  right: string,
  statuses: string[],
  separator: string,
  innerWidth: number,
): string {
  const leftWidth = visibleWidth(left)
  const rightWidth = visibleWidth(right)
  const minimumGap = leftWidth > 0 && rightWidth > 0 ? 1 : 0
  if (leftWidth + minimumGap + rightWidth > innerWidth) {
    return composeBuiltInRow(left, right, innerWidth)
  }
  const available = Math.max(0, innerWidth - leftWidth - rightWidth - minimumGap)
  let nextRight = right
  if (statuses.length > 0) {
    const connector = rightWidth > 0 ? visibleWidth(separator) : 0
    const fitted = fitStatusTexts(statuses, Math.max(0, available - connector), separator)
    nextRight = prependStatusArea(right, fitted, separator)
  }
  const gapWidth = Math.max(0, innerWidth - leftWidth - visibleWidth(nextRight))
  return `${left}${" ".repeat(gapWidth)}${nextRight}`
}

function composeBuiltInRow(left: string, right: string, innerWidth: number): string {
  const leftWidth = visibleWidth(left)
  const rightWidth = visibleWidth(right)
  if (leftWidth >= innerWidth) return truncateToWidth(left, innerWidth, "")
  return leftWidth + 1 + rightWidth <= innerWidth
    ? `${left}${" ".repeat(innerWidth - leftWidth - rightWidth)}${right}`
    : truncateToWidth(left, innerWidth, "")
}

// Fit as many separator-joined statuses as the width allows; a lone status
// that cannot fit truncates with an ellipsis (zentui fitStatusTexts).
// Note: pi's truncateToWidth appends an \x1B[0m reset after any truncated
// fragment (closing styles mid-string); zentui's footer truncates through
// the same helper, so the resets are faithful, not a defect
export function fitStatusTexts(statusTexts: string[], maxWidth: number, separator: string): string {
  if (maxWidth <= 0) return ""
  const fitted: string[] = []
  for (const text of statusTexts) {
    const candidate = joinStatusTexts([...fitted, text], separator)
    if (visibleWidth(candidate) <= maxWidth) {
      fitted.push(text)
      continue
    }
    if (fitted.length === 0) {
      return maxWidth > 1 ? truncateToWidth(text, maxWidth, "…") : ""
    }
    break
  }
  return joinStatusTexts(fitted, separator)
}

function joinStatusTexts(statusTexts: string[], separator: string): string {
  return statusTexts.filter(Boolean).join(separator)
}

function prependStatusArea(base: string, statusText: string, separator: string): string {
  if (base === "") return statusText
  if (statusText === "") return base
  return `${statusText}${separator}${base}`
}

// The footer row is framed by a single space on each side. Truncation here
// goes through pi's truncateToWidth, which appends an \x1B[0m reset after the
// clipped fragment - the same helper and the same behavior zentui's footer
// frame uses
function frameFooterRow(row: string, width: number): string {
  const framed = width > 2 ? ` ${truncateToWidth(row, width - 2, "")} ` : row
  return truncateToWidth(framed, width, "")
}
