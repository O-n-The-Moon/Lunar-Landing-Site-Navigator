# Contributing

48-hour hackathon, 4 people, one `main`. These rules exist so we never block each other.

## The rules
1. **Never push directly to `main`.** Every change goes through a pull request.
2. **One issue → one branch → one PR.** Pick an issue from the [project board](https://github.com/orgs/O-n-The-Moon/projects/1) / [issues](https://github.com/O-n-The-Moon/Lunar-Landing-Site-Navigator/issues), assign yourself, then branch.
3. **Branch name = `<issue-number>-<short-description>`**, kebab-case, from the latest `main`:
   ```bash
   git switch main && git pull
   git switch -c 8-horizon-ray-march
   ```
   Every issue body lists a suggested branch name.
4. **PR title** = issue title; **PR description** starts with `Closes #<issue-number>` so the issue closes on merge.
5. **Stay inside your issue's "Files owned by this issue" list.** That's how parallel work avoids merge conflicts. If you must touch another file, say so in the PR description and ping that issue's owner.
6. **Small PRs, merged often.** Rebase on `main` before opening (`git pull --rebase origin main`). Prefer several small PRs over one big one at hour 40.
7. **Check before opening a PR** (only the side you touched):
   ```bash
   cd pipeline && uv run pytest && uv run ruff check . && uv run ruff format --check .
   cd web && npm test && npm run lint && npm run build
   ```
8. **Review:** one teammate approves (a quick look is fine at a hackathon). Use **squash merge**. Delete the branch after merge.

## Commit messages
Short, imperative, reference the issue: `Add numba horizon ray-march (#8)`.

## Blocked?
- An issue's **Blocked by** list shows what must merge first. If the blocker isn't merged yet, build against the fixtures in `web/src/engine/__fixtures__/` (see "Soft dependency" in the issue).
- Need a change to the **data contract** (`SPEC.md` → Data Contract)? Don't change it in your PR. Raise it with the team first, because it affects all modules.
- New idea mid-build? Add it to **Out of Scope (Deferred)** in `SPEC.md` instead of building it. No new P0 features after Checkpoint 2 (h30).

## Never commit
Raw DEMs, SPICE kernels, `pipeline/data/raw/`, files over 25 MB, `.env` / secrets.

## Where things are
| Read | For |
|---|---|
| [`SPEC.md`](SPEC.md) + `SPEC-*.md` | What we're building (source of truth) |
| [`tasks/plan.md`](tasks/plan.md) | Timeline, phases, issue index, critical path |
| [`docs/ideas/lunar-landing-site-navigator.md`](docs/ideas/lunar-landing-site-navigator.md) | Why we chose this direction |
