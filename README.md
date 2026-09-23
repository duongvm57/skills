# Codex Skills

This repository contains the English `grill-async-with-docs` Codex skill. It
prepares an asynchronous clarification interview for BA and DEV in one offline
HTML file with answer-dependent questions.

## Install with Vercel Skills CLI

Install the skill for Codex from GitHub:

```bash
npx skills add duongvm57/skills --skill grill-async-with-docs -g -a codex
```

To install it in the current project instead of your personal Codex directory,
omit `-g`:

```bash
npx skills add duongvm57/skills --skill grill-async-with-docs -a codex
```

List globally installed skills with `npx skills ls -g -a codex`; update this
global installation with `npx skills update grill-async-with-docs -g`.

## Development

The repository uses the Vercel Skills CLI multi-skill layout:

```text
skills/grill-async-with-docs/SKILL.md
```

References, HTML assets, the CLI, examples, and tests live beside `SKILL.md`.
See the [skill README](skills/grill-async-with-docs/README.md) for the workflow,
packet commands, and detailed checks.

```bash
cd skills/grill-async-with-docs
node --test tests/core.test.mjs
python3 tests/browser_test.py --out /tmp/grill-browser-checks
```
