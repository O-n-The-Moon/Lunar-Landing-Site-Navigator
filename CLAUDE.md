@AGENTS.md

## Claude Code specifics
- Before starting work, read the GitHub issue (`gh issue view <N>`) and only the spec section it links.
- Skills come from the `agent-skills` plugin (`.claude/settings.json`). Use them for these situations:

| When | Use |
|---|---|
| Starting/implementing an issue | `agent-skills:incremental-implementation` |
| Engine or pipeline math, any bug fix | `agent-skills:test-driven-development` |
| Building React UI (controls, views, layout) | `agent-skills:frontend-ui-engineering` |
| Failing test, broken build, wrong output | `agent-skills:debugging-and-error-recovery` |
| SPICE, rasterio/LOLA, PGDA, Horizons API, numba, D3: any library/data-format call | `agent-skills:source-driven-development` (check official docs, don't guess) |
| Perf budgets: slip slider ≤ 33 ms, engine ≤ 5 ms/site, grid score ≤ 3 s, load ≤ 3 MB | `agent-skills:performance-optimization` (measure first) |
| CI workflow (#2), Vercel deploy (#19) | `agent-skills:ci-cd-and-automation` |
| Reviewing a teammate's PR | `agent-skills:code-review-and-quality` |
| Before opening a PR | `/code-review` |
| Commits, branches, PRs | `agent-skills:git-workflow-and-versioning` (branch/PR rules in `CONTRIBUTING.md` win) |
- Personal overrides go in `CLAUDE.local.md` (gitignored), not here.
