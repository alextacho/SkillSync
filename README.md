# SkillSync

SkillSync is a project-local CLI that lets you author agent assets in normal repo folders and project them into runtime folders used by Claude, Codex, and related local agent setups.

It is built for this workflow:

- edit canonical sources in `skills/`, `agents/`, and `commands/`
- run `skillsync watch`
- immediately test the generated runtime assets in `.claude/`, `.codex/`, and `.agents/`

## What it does

- Watches canonical source folders: `skills/`, `agents/`, `commands/`
- Generates provider runtime files into `.claude/`, `.codex/`, and `.agents/`
- Tracks generated file hashes in `.skillsync/state.json`
- Warns if generated files were edited manually
- Detects drift with `skillsync diff`
- Updates project `AGENTS.md` with Codex command hints

## Install

### Local development

From this repo:

```bash
npm link
```

Then in any project:

```bash
skillsync watch --project /path/to/your-project
```

### Run from a cloned GitHub repo

```bash
git clone <repo-url> /tmp/skillsync
node /tmp/skillsync/bin/skillsync.js watch --project /path/to/your-project
```

### Install from GitHub

Once this repo is hosted remotely, you can install it directly:

```bash
npm install -g github:alextacho/skillsync
skillsync watch --project /path/to/your-project
```

## Project setup

Initialize a target project:

```bash
skillsync init --project /path/to/your-project
```

That creates:

- `skillsync.config.json`
- `skills/`
- `agents/`
- `commands/`

## Source conventions

### Skills

- `skills/**/skill.md` defines one skill package
- sibling files can be referenced via `include:`

Example:

```md
---
name: haiku-drafting
description: Draft concise haiku with clear seasonal imagery.
include:
  - rules.md
---
Write haiku that feel simple, vivid, and deliberate.
```

### Agents

- `agents/**/agent.md` defines one agent package
- sibling files can be referenced via `include:`

### Commands

- `commands/*.md` defines one slash command

Example:

```md
---
name: feeling-poetic
description: Generate a fresh haiku from the current mood or context.
slash: /feeling-poetic
---
Write a new haiku inspired by the current conversation or environment.
```

## Generated output

SkillSync projects the canonical sources into:

- `.claude/skills/...`
- `.claude/commands/...`
- `.claude/agents/...`
- `.codex/skills/...`
- `.codex/commands/...`
- `.codex/agents/...`
- `.agents/skills/...`
- `.agents/commands/...`
- `.agents/agents/...`

It also writes:

- `.skillsync/state.json`
- `.codex/COMMANDS.md`
- `AGENTS.md` managed command hints for Codex

## Commands

```bash
skillsync init --project /path/to/project
skillsync build --project /path/to/project
skillsync watch --project /path/to/project
skillsync diff --project /path/to/project
skillsync doctor --project /path/to/project
```

If `--project` is omitted, SkillSync uses the current working directory.

## Git ignore

In target repos, ignore generated output:

```gitignore
.skillsync/
.claude/
.codex/
.agents/
```

## Codex commands

Codex does not appear to support native project slash-command registration in the same way Claude does. SkillSync works around that by:

- generating `.codex/commands/*.md`
- generating `.codex/COMMANDS.md`
- updating the project root `AGENTS.md` with managed command instructions

This makes commands discoverable to Codex in a new session opened at the target project root.

## Playground

This repo includes a runnable sandbox in `playground/`:

```bash
npm run playground:watch
```

Open Claude or Codex in `playground/` and test the generated assets there.

## Publishing

See `RELEASE.md` for a practical checklist covering GitHub metadata, npm packaging, and release steps.
