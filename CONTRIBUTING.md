# Contributing to ISP

ISP is in active prototype development. Contributions are welcome, but please read this document before opening a PR — the project has strong opinions about scope and code style.

---

## What Is and Isn't In Scope

This project has a deliberate roadmap in [DEVELOPMENT_PHASES.md](DEVELOPMENT_PHASES.md). Contributions that align with the next planned version are easiest to merge. Contributions that jump ahead, introduce framework dependencies, or significantly alter the tone/design direction will likely be declined or deferred.

**Good contributions:**
- Bug fixes and edge case handling in existing systems
- Balance adjustments with reasoning (economy, progression, market)
- Small, focused feature work in the current development version
- Accessibility improvements
- Documentation and lore additions that fit the established tone

**Out of scope now:**
- Frontend framework migration (React, Vue, etc. — the no-build-step constraint is deliberate)
- Database migration (PostgreSQL/Supabase is planned but not yet; don't pre-empt it)
- New resource types or game systems beyond the current roadmap version
- UI visual redesigns (the v1.0 facelift is a planned, coordinated effort)

---

## Code Style

### General
- **No build step.** The client is served as-is. No bundlers, transpilers, or preprocessors.
- **No frontend dependencies** beyond Chart.js and Socket.io (which are already in use).
- Keep files in the established locations — don't reorganize the project structure without discussion.

### JavaScript
- ESM (`import`/`export`) throughout — both server and client.
- No TypeScript. Prefer clear variable names and short functions over type annotations.
- `const` by default; `let` only when reassignment is needed.
- Async/await for all async paths. No `.then()` chains.
- `escapeHtml()` for all user-supplied or data-driven values injected into HTML.

### CSS
- Use the established CSS custom properties (`--accent`, `--text`, `--muted`, `--surface`, `--border`, `--warn`).
- New component styles go near the bottom of `styles.css`, grouped with a `/* ─── Section name ─── */` header comment.
- Mobile-first isn't enforced, but responsive breakpoints should be included for any new layout components.

### Server
- All state mutations go through `mutateState()` (global) or `mutateAccountState()` (per-account). Never write to `state` or `accountsStore` directly in route handlers.
- Call `saveAccountsNow()` after any critical state change that must survive an immediate restart.
- Validate and sanitize all `req.body` fields at the top of route handlers. Return 400 with a clear error before touching state.

---

## TDD Checklist

ISP now follows a strict Test Driven Development workflow.

Before opening a PR, ensure all of the following are true:
- You wrote the failing test first for new behavior (Red).
- You implemented the smallest code change needed to pass (Green).
- You refactored only after tests were passing, and kept them green (Refactor).
- Every bug fix includes a regression test that fails before the fix and passes after it.
- Behavior changes update tests first, then implementation.
- You ran the full test suite locally (`npm test`) and it passes.
- New functionality includes appropriate test coverage (unit for logic, integration for routes/workflows).

If a change cannot be tested reasonably, explain why in the PR description and propose a follow-up test plan.

---

## Branching

- `main` — stable. Only merge when something works end-to-end.
- Feature branches: `feature/short-description`
- Bug fixes: `fix/short-description`

Open a PR against `main`. Keep PRs small and focused — one thing per PR.

---

## Reporting Issues

Use GitHub Issues. Include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser and Node version

---

## Tone Note

ISP has a specific voice — cold, institutional, dry corporate sci-fi. If you're writing UI copy, lore, notification text, or in-game messages, read [LORE.md](LORE.md) first and match the register. The ISA doesn't say "Oops, something went wrong." It says "This request could not be processed. Reference number: [id]."
