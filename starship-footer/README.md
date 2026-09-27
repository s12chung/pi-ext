# Starship Footer Extension for pi

Replaces pi's footer, and only the footer, with [pi-zentui](https://github.com/lmilojevicc/pi-zentui)'s starship status line in one fixed setup (no configuration, no templates, no compact reflow):

```
 {cwd} in {session} on {branch}    {ext-statuses |} {model} {Provider} {thinkingLevel} | {ctx}%/{window} | {$cost}
```

```
 pi-ext in footer work on * main    ok | ⏸ plan | sonnet-4-5 Anthropic high | 6.2%/200k | $0.042
```

Colors match pi-zentui's starship footer; the model/provider/thinking segment uses the editor's colors.

## Install

```sh
mkdir -p ~/.pi/extensions
ln -s "$(pwd)" ~/.pi/extensions/starship-footer
```

## Tests

From the repo root:

```sh
npm install
npm test
npm run typecheck
```
