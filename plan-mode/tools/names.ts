/**
 * Identity of the extension's registered tools: the names pi registers them
 * under and the version stamped into plan_complete's persisted details.
 * Shared by registration (completion-tool.ts, questionnaire.ts), tool-set
 * selection (utils.ts), and session decoding (decode.ts).
 */

// Adapted from upstream's plan_mode_complete
export const PLAN_COMPLETE_TOOL_NAME = "plan_complete"
export const PLAN_COMPLETE_VERSION = 1

export const QUESTIONNAIRE_TOOL_NAME = "questionnaire"
