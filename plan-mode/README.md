# Plan Mode Extension for pi

Read-only exploration mode for [pi](https://github.com/earendil-works/pi): the agent analyzes code and produces a decision-ready plan before any files change. Plans are submitted through a structured `plan_complete` tool call and live in session memory — never in files.

Started from pi's bundled `examples/extensions/plan-mode`, with the structured completion tool and state recovery adapted from [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-plan-mode) and the fresh-session handoff from [bacnh85/pi-extensions](https://github.com/bacnh85/pi-extensions/tree/main/pi-plan). Prompts are adapted from [anomalyco/opencode](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt/plan-mode.txt) Per-change sources are cited in code comments.

## Quickstart

1. Install into your user extensions directory (or `<project>/.pi/extensions/` for project-only), from this directory:

```sh
mkdir -p ~/.pi/extensions
ln -s "$(pwd)" ~/.pi/extensions/plan-mode
```

2. Start pi and enter plan mode with `/plan`.
3. Ask the agent to analyze code and plan a change. While planning:
   - `edit`/`write` are disabled and bash is restricted to a read-only allowlist
   - the editor border above and below the prompt turns orange, heavy-weight (theme `mdHeading` role); any installed custom editor (e.g. a theme UI) is wrapped, not replaced
   - with [pi-zentui](https://github.com/lmilojevicc/pi-zentui), set its editor border color mode to **adaptive** (`/zentui` → editor → Editor border color): the frame then follows the dynamic border - zen's usual `borderMuted` gray while idle, orange heavy-weight while planning
   - the agent asks clarifying questions via the `questionnaire` tool
   - for uncertain scope, the agent can launch up to 3 read-only explore children in parallel via the one allowlisted `pi --print` command
4. When the plan is decision-ready, the agent calls `plan_complete` with the plan as free-flow markdown — numbered phase headings in broad strokes, ending with a testing and verification phase. Invalid formats are rejected with a corrective error so the agent resubmits; only a valid plan is displayed.
5. Choose what happens next:
   - **Execute in fresh session (recommended)** — starts a new session whose kickoff prompt embeds the plan; the planning transcript stays behind in the parent session
   - **Execute in current session** — restores full tool access and runs the plan in place
   - **Stay in plan mode** / **Refine the plan** — keep iterating
   - **Exit plan mode (discard plan)** — drop the plan and restore full tool access

## Commands

| Command | Action |
|---|---|
| `/plan` | Toggle plan mode; with a completed plan, reopen the approval picker |
| `/todos` | Show the current plan phases |

## Persistence and recovery

State is appended to the session file via `appendEntry("plan-mode", ...)`. On resume, the latest entry restores the mode, plan, and prior tool set. If pi crashes between a `plan_complete` call and the next state append, the plan is recovered from that tool result's details.

## Tests

From the repo root (installs the type dependencies into the root `node_modules`):

```sh
npm install
npm test
npm run typecheck
```
