@AGENTS.md

## Claude Code specifics
- Project skills come from the `agent-skills` plugin (`.claude/settings.json`). Useful ones: `agent-skills:incremental-implementation`, `agent-skills:test-driven-development`, `agent-skills:debugging-and-error-recovery`.
- Before starting work, read the GitHub issue (`gh issue view <N>`) and only the spec section it links.
- Personal overrides go in `CLAUDE.local.md` (gitignored), not here.
