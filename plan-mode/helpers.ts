import { stripVTControlCharacters } from "node:util"

/**
 * Safe reporting utilities: stale-tolerant UI calls and sanitized error text.
 */

// Reports whether the operation landed: session replacement invalidates the
// captured context mid-flight, so late UI work - on either the source or the
// replacement context - tolerates its throws instead of failing the handoff
export function bestEffort(operation: () => void): boolean {
  try {
    operation()
    return true
  } catch {
    return false
  }
}

// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (safeErrorDetail)
export function safeErrorDetail(error: unknown): string {
  const flat =
    stripVTControlCharacters(error instanceof Error ? error.message : String(error))
      // C0/C1 controls corrupt terminal rendering, and bidi overrides reorder
      // text so the displayed message differs from the actual content; error
      // messages embed workspace-controlled paths and names, so neither can be
      // trusted
      // oxlint-disable-next-line no-control-regex -- stripping control characters is this line's purpose
      .replaceAll(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/gu, " ")
      .replaceAll(/\s+/gu, " ")
      .trim() || "unknown error"
  return flat.length > 500 ? `${[...flat].slice(0, 499).join("")}…` : flat
}
