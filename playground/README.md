# Playground

This folder is a ready-to-run sandbox for SkillSync.

## Run it

```bash
npm run playground:doctor
npm run playground:build
npm run playground:watch
```

## Edit these sources

- `skills/haiku-drafting/skill.md`
- `skills/haiku-drafting/rules.md`
- `skills/haiku-review/skill.md`
- `skills/haiku-review/checklist.md`
- `agents/poet/agent.md`
- `agents/poet/style.md`
- `commands/feeling-poetic.md`
- `commands/remix-haiku.md`

## Generated runtime folders

- `.claude/`
- `.codex/`
- `.agents/`

When you save a source file while `watch` is running, SkillSync rebuilds the owning artifact and rewrites the corresponding runtime files atomically.
