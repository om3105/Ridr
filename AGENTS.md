# Ridr development workflow

These rules record the project owner's development and Git instructions. Apply them in every development session.

## Scope and incremental work

- Work on the requested milestone, not the entire application in one step. Use the Day 1 requirements baseline in `docs/day-01/` and preserve explicit conditional/deferred scope.
- Follow the sequence: understand the requirement, inspect existing work, plan a small change, implement, run relevant checks, fix real issues, review, commit, then proceed to the next logical task.
- Split larger work into coherent implementation steps when useful. Do not artificially split small changes or add work merely to increase commit count.
- Do not begin later milestones merely because their requirements are documented.

## Inspect before changing

- Read applicable repository instructions, existing code, and configuration.
- Run `git log --oneline --decorate -10` and `git status` before changes. An unborn branch has no log; report that accurately.
- Follow existing architecture, naming, formatting, tests, and branch/commit conventions. Do not overwrite unrelated local changes.

## Engineering and validation

- Use meaningful names, sensible folders, consistent formatting, reusable components where helpful, and useful comments rather than narration.
- Include appropriate error handling, validation, important-behavior tests, setup documentation, `.gitignore`, and environment examples when those become relevant.
- Keep changes proportional to the requirement; do not add unnecessary files, dependencies, scaffolding, or complexity.
- After meaningful changes, run the relevant existing tests, lint/type checks, and build where applicable. Inspect the result and fix failures before committing.
- Run only commands that exist or are appropriate. Never claim a check passed unless it actually ran. Until executable code/tooling exists, documentation and repository checks are appropriate; do not invent application test/build results.
- Fix genuine discovered bugs naturally. A separate fix commit is useful only when it represents real work; never introduce bugs deliberately.

## Commit procedure

Before every commit:

1. Run `git status` and `git diff` and inspect the changes.
2. Stage only intended paths with `git add <specific-files>`; do not sweep unrelated files into the index.
3. Run `git diff --staged` and review the full staged change, including new files and possible secrets.
4. Confirm the appropriate checks ran successfully.
5. Commit with a concise, specific imperative message describing the actual work, such as `Add ride group validation` or `Document beta acceptance criteria`.
6. Run `git status` and `git log -1 --oneline` to verify the result.

Every commit must represent an actual, verified change. Do not use vague messages such as “Update,” “Changes,” “Fix stuff,” “Final,” “Done,” “AI generated,” or “Various changes.” Do not force every commit into a repetitive template.

## Truthful history

- Preserve real authorship and actual Git timestamps. Do not backdate, manipulate dates, fabricate a multi-day timeline, or create empty/fake changes, tests, fixes, or refactors.
- Do not conceal AI involvement by manufacturing evidence of human authorship. History records work actually performed, even when it happened in one session.
- Do not rewrite history unless explicitly requested.
- Committing locally does not imply permission to push, publish, or deploy. Follow the user's authorization for those actions.

## Milestone handover and completion

- Before declaring a milestone done, review the actual diff, applicable checks, documentation accuracy, scope, and final Git state.
- Before declaring the application complete, verify its build, tests, lint/type checks where applicable, no unintended files or secrets committed, accurate README/setup instructions, appropriate ignore rules, clean Git status, and truthful meaningful history.
- Summarize what changed, checks actually run, remaining issues, and final Git status. Distinguish a finished planning milestone from a finished application.
