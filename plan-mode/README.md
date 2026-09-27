# Plan Mode Extension for pi

Read-only exploration mode for [pi](https://github.com/earendil-works/pi): the agent analyzes code and produces a decision-ready plan before any files change. Plans are submitted through a structured `plan_complete` tool call and live in session memory — never in files.

Started from pi's bundled `examples/extensions/plan-mode`, with the structured completion tool and state recovery adapted from [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-plan-mode) and the fresh-session handoff from [bacnh85/pi-extensions](https://github.com/bacnh85/pi-extensions/tree/main/pi-plan). Prompts are adapted from [anomalyco/opencode](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt)'s plan-mode.txt and plan.txt. Per-change sources are cited in code comments.

## Quickstart

1. Install into your user extensions directory (or `<project>/.pi/extensions/` for project-only), from this directory:

```sh
mkdir -p ~/.pi/extensions
ln -s "$(pwd)" ~/.pi/extensions/plan-mode
```

2. Start pi and enter plan mode with `/plan`.
3. Ask the agent to analyze code and plan a change. While planning:
   - `edit`/`write` are disabled and the plan-mode prompt directs the agent to keep bash strictly read-only
   - the editor border above and below the prompt turns orange, heavy-weight (theme `mdHeading` role); any installed custom editor is wrapped, not replaced
   - the agent asks clarifying questions via the `questionnaire` tool
4. When the plan is decision-ready, the agent calls `plan_complete` with the plan as free-flow markdown — numbered phase headings in broad strokes, ending with a testing and verification phase. Invalid formats are rejected with a corrective error so the agent resubmits; only a valid plan is displayed.
5. Choose what happens next:
   - **Execute in fresh session** — starts a new session whose kickoff prompt embeds the plan; the planning transcript stays behind in the parent session
   - **Stay and refine the plan** — keep iterating; an empty refinement submission (or Esc, on either the picker or the editor) just stays
   - **Exit plan mode (plan stays in context)** — restore full access; the plan remains in the transcript, so you can act on it yourself

## Commands

| Command      | Action                                                              |
| ------------ | ------------------------------------------------------------------- |
| `/plan`      | Toggle plan mode; with a completed plan, reopen the approval picker |
| `/plan exec` | Run the completed plan in a fresh implementation session            |

## Persistence and recovery

State is appended to the session file via `appendEntry("plan-mode", ...)`. On resume, the latest entry restores the mode, plan, and prior tool set. If pi crashes between a `plan_complete` call and the next state append, the plan is recovered from that tool result's details.

## Tests

From the repo root (installs the type dependencies into the root `node_modules`):

```sh
npm install
npm test
npm run typecheck
```
