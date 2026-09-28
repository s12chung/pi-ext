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
   - the plan-mode reminder directs the agent to leave the workspace unchanged, bash included, while allowing experiments inside a temporary folder (soft enforcement - there are no code-level tool locks)
   - the editor border above and below the prompt turns orange, heavy-weight (theme `mdHeading` role); any installed custom editor is wrapped, not replaced
   - the agent asks clarifying questions via the `questionnaire` tool
4. When the plan is decision-ready, the agent calls `plan_complete` with the plan as free-flow markdown — numbered phase headings in broad strokes, ending with a testing and verification phase. Invalid formats are rejected with a corrective error so the agent resubmits; only a valid plan is displayed.
5. Choose what happens next:
   - **Execute in fresh session** — starts a new session whose kickoff prompt embeds the plan; the planning transcript stays behind in the parent session
   - **Stay in plan mode** — keep iterating in the conversation; `/plan` will prompt the approval (Esc just stays)
   - **Exit plan mode (plan stays in context)** — restore full access; the plan remains in the transcript, so you can act on it yourself

## Commands

| Command      | Action                                                              |
| ------------ | ------------------------------------------------------------------- |
| `/plan`      | Toggle plan mode; with a completed plan, reopen the approval picker |
| `/plan exec` | Run the completed plan in a fresh implementation session            |

## Persistence and recovery

State is appended to the session file via `appendEntry("plan-mode", ...)`: when the mode changes and when `plan_complete` stages a plan. On resume, the latest entry restores the mode and plan — the persisted plan is the only source, with no recovery from tool results. Session start also reconciles the active tools once into the constant set (the restored loadout plus `grep`/`find`/`ls` and the plan helpers), which also repairs sessions recorded under older per-mode tool swaps.

## Design: cache-stable toggles

Toggling plan mode never rewrites the provider request prefix (tools → system → messages), so prompt caches stay warm across toggles — opencode's design:

- **Constant tool array** — session start reconciles the active tools once into a fixed union and never touches it again. Tools are never hidden or blocked in code — enforcement is the reminder itself — so both modes' requests carry identical tool arrays.
- **Append-only reminders** — the mode prompt rides as a request-local text block appended to the newest user message (pi clones the transcript for `context` handlers and restores it afterwards, so nothing persists). It lands on the fresh-turn user text or the mid-run tool results — both user-role in the provider payload — so it rides every request while re-reading only the always-uncached tail, instead of system-prompt sections that would diff the cached prefix on every toggle.

## Tests

From the repo root (installs the type dependencies into the root `node_modules`):

```sh
npm install
npm test
npm run lint
```
