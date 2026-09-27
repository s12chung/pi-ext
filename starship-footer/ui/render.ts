/**
 * The starship footer's layout engine: zentui's single-row composition for
 * one fixed setup, by joining index.ts's segments. Pure layout, so it renders
 * without a theme, ExtensionContext, or FooterDataProvider - index.ts composes
 * the sides, separator, and statuses from pi's live data (state.ts labels
 * through color.ts specs) and hands them over with the width. Overflow follows
 * zentui's non-compact path: statuses drop first, then the right side, then
 * the left side truncates - no compact reflow.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

// The sides' segments and separator index.ts composes from pi's live data,
// plus the extension statuses; joining and layout happen here
export interface FooterRowParts {
  left: readonly string[]
  right: readonly string[]
  separator: string
  statuses: readonly string[]
}

export function renderFooterRow(width: number, parts: FooterRowParts): string[] {
  if (width <= 0) return [""]
  const innerWidth = Math.max(1, width - 2)
  const row = composeFooterRow(
    joinSegments(parts.left),
    joinSegments(parts.right, parts.separator),
    parts.statuses,
    parts.separator,
    innerWidth,
  )
  return [frameFooterRow(row, width)]
}

// Join optional segments, dropping the empty ones
export function joinSegments(segments: readonly string[], separator = " "): string {
  return segments.filter(Boolean).join(separator)
}

// zentui's composeFooterContent for left/right zones plus right-placed
// extension statuses: when everything fits, statuses squeeze into the gap
// before the right side; when the built-ins alone overflow, the right side
// drops entirely and the left side truncates
export function composeFooterRow(
  left: string,
  right: string,
  statuses: readonly string[],
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
export function fitStatusTexts(
  statusTexts: readonly string[],
  maxWidth: number,
  separator: string,
): string {
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

function joinStatusTexts(statusTexts: readonly string[], separator: string): string {
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
