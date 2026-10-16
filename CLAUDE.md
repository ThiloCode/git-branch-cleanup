# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Interactive Node/TypeScript CLI that lists local git branches and worktrees in a checkbox prompt and deletes the selected ones. Branches merged into the base branch are pre-checked. The current branch and protected branches (`main`, `master`, `develop`, the detected base, plus any `--protect`) cannot be selected, and neither can branches checked out in the main worktree.

## Commands

```bash
npm install
npm run build   # tsc -> dist/
npm run dev     # tsc --watch
npm start       # node dist/bin.js (run it from inside a git repo to test)
node dist/bin.js --dry-run   # exercise the full flow without deleting anything
npm run playground [-- <dir>]   # (re)create a sandbox repo with every branch/worktree state, default in the OS temp dir
```

For manual testing, run the CLI from `<playground>/repo`. The script prints what each branch and worktree is meant to demonstrate, so update that listing when you add cases to `scripts/playground.mjs`.

There is no test suite and no linter; `npm run build` (strict `tsc`) is the only check. `npm link` installs the `git-branch-cleanup` command globally.

## Architecture

- `src/bin.ts`: entry point. Hand-rolled argument parsing (no CLI library), protected-branch filtering, the confirm/delete loop, and the summary. Selections are `CleanupTarget`s (`src/types.ts`): either a branch, which may carry its worktree, or a worktree with no branch. If a target has a worktree, it is removed first. If that removal fails, the branch is left alone. Branch deletion first tries `git branch -d`. If that fails, it asks per branch (or uses `--force`) before falling back to `-D`.
- `src/git.ts`: all git access goes through `execFile("git", ...)`. `loadBranches` runs in two parallel phases, and the number of git calls never grows with the number of branches:
  1. `for-each-ref` for names and the current branch (it also serves as the "not a git repo" check), `git worktree list --porcelain`, and `rev-parse --show-toplevel` to identify the current worktree.
  2. One batched `for-each-ref` that uses the `%(ahead-behind:<base>)` atom to compute merge status for every branch. Alongside it, each removable worktree gets one `status --porcelain`, and each detached worktree gets one `rev-list --count <head> --not --branches --tags --remotes`.

  Keep it that way; spawning git once per branch is the regression that commit d486714 removed. The `ahead-behind` atom needs git ≥ 2.41. A branch counts as "merged" when it is 0 commits ahead of the base.
- Worktree safety rule: `removeWorktree` passes `--force` only when the list already showed the worktree as having uncommitted changes. Since the user selected it knowing that, there is no extra prompt. A failed status check is treated as clean, so git's own check still applies, and so do changes made after the list loaded. Worktrees that could lose work, or that are locked, are never pre-checked. Locked worktrees are removed by running `unlock` and then a normal `remove`. Don't use `remove -f -f`: it also discards uncommitted changes without checking. If the removal fails, the lock is restored with its original reason.
- `src/ui.ts`: `@inquirer/prompts` checkbox and confirm prompts. `bin.ts` loads it with a dynamic `import("./ui.js")` in parallel with `loadBranches`, inside the loading spinner, so that inquirer's load time overlaps the git calls. Don't turn it into a static import.
- `src/spinner.ts`: a small spinner of our own. When stdout is not a TTY it prints one static line instead of redrawing with `\r`.

## Conventions

- ESM with `"module": "NodeNext"`: relative imports must use the `.js` extension (`./git.js`), even from `.ts` files.
- In `git()`, use only `trimEnd()` on stdout, never `trim()`: the `%(HEAD)` atom prints a leading space for non-current branches, and a full trim would shift the tab-separated fields on the first line.
- Node ≥ 18. Runtime dependencies are limited to `@inquirer/prompts` and `picocolors`.
