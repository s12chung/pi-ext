# Plan Mode

Read-only exploration mode for [pi](https://github.com/earendil-works/pi): the agent explores code and produces a decision-ready plan before any file changes. Toggle it with `/plan`.

- **Soft enforcement, cache-stable** — the mode prompt directs the agent to leave the workspace unchanged (experiments inside a temporary folder are allowed); there are no tool locks. The prompt lands on the message tail and the tool array never changes, so toggling never breaks the cached request prefix.
- **Handoff to a fresh session, no lingering artifacts** — on approval, execution starts in a fresh session whose kickoff prompt embeds the plan; the planning transcript and plan-mode state stay behind in the parent session.

## Install

Into your user extensions directory (or `<project>/.pi/extensions/` for project-only), from this directory:

```sh
mkdir -p ~/.pi/extensions
ln -s "$(pwd)" ~/.pi/extensions/plan-mode
```

## Quickstart

1. Start pi and enter plan mode with `/plan` — the editor border turns orange while planning.
2. Ask the agent to analyze code and plan a change; it may ask clarifying questions along the way.
3. When the plan is ready, the agent submits it via `plan_complete`. Choose to execute in a fresh session, keep iterating, or exit plan mode with the plan still in context.

## Configuration

All the prompts, including the tool descriptions, can be overwritten from `<agent-dir>/plan-mode.json` (agent dir: `PI_CODING_AGENT_DIR` or `~/.pi/agent`):

- `planModePrompt` - appended to every request while planning
- `planModeEndedPrompt` - appended to requests right after leaving plan mode
- `planCompleteDescription` - the `plan_complete` tool description
- `planFormatDescription` - what the `plan_complete` plan parameter should contain
- `questionnaireDescription` - the `questionnaire` tool description
- `planCommandDescription` - the `/plan` command description

## Tests

From the repo root (installs the type dependencies into the root `node_modules`):

```sh
npm install
npm test
npm run lint
```

## Inspiration

Started from pi's bundled `examples/extensions/plan-mode`, with pieces adapted from [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions) and [bacnh85/pi-extensions](https://github.com/bacnh85/pi-extensions), and prompt and context-management inspiration from [anomalyco/opencode](https://github.com/anomalyco/opencode); per-change sources are cited in code comments.
