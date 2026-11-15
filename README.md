# Lunar-Landing-Site-Navigator
Lunar Landing Site Navigator - NASA Hackathon

## Project docs

| Read this | For |
|---|---|
| [`docs/ideas/lunar-landing-site-navigator.md`](docs/ideas/lunar-landing-site-navigator.md) | **Why**: ideas considered, must-haves, not doing, nice-to-haves |
| [`SPEC.md`](SPEC.md) | **What**: objective, data contract, success criteria, boundaries (source of truth) |
| [`SPEC-data-pipeline.md`](SPEC-data-pipeline.md) · [`SPEC-engine.md`](SPEC-engine.md) · [`SPEC-app.md`](SPEC-app.md) | Per-module specs |
| [`tasks/plan.md`](tasks/plan.md) | **How/when**: timeline, roles, issue index (tasks live in GitHub Issues) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch/PR workflow (never push to `main`, squash merge only) |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | Short context + conventions for AI coding agents |
| `docs/demo.md` | Demo script (written during the build) |

## Deploy

Static site on Vercel (no backend). Vercel project root is `web/` (Vite preset, Node 22); `main` deploys to production and every PR gets a preview URL.

- **Production:** https://lunar-landing-site-navigator-sooty.vercel.app
- Data files are served from `web/public/data/` (e.g. `/data/ephemeris.json`).
