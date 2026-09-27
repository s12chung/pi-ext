/**
 * Env-gated trace for menu/handoff diagnosis: PLAN_MODE_DEBUG=<file> pi ...
 */

import { appendFileSync } from "node:fs"
import type { JsonValue } from "@earendil-works/pi-ai"

export function debugLog(event: string, data?: JsonValue): void {
  const path = process.env.PLAN_MODE_DEBUG
  if (!path) return
  try {
    appendFileSync(
      path,
      `${new Date().toISOString()} ${event}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`,
    )
  } catch {
    // diagnostics must never break the session
  }
}
