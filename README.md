# git-branch-cleanup

Interactive CLI to review and delete local git branches and worktrees. Navigate with the
arrow keys, toggle branches for deletion with the spacebar, confirm with
enter.

## Install

```bash
npm install
npm run build
npm link
```

`npm link` makes the `git-branch-cleanup` command available globally. Without
linking, run it via `npm start` or `node dist/bin.js` from this directory.

## Usage

Run inside any local git repository:

```bash
git-branch-cleanup
```

- Branches already merged into the detected base branch are pre-checked.
- The current branch and protected branches (`main`, `master`, `develop`, and
  the detected base branch) are excluded from selection.
- A branch that isn't fully merged fails a safe delete (`git branch -d`); you
  are asked per branch whether to force-delete it (`git branch -D`).

### Worktrees

- Deleting a branch that is checked out in a linked worktree removes that
  worktree first (`git worktree remove`), then deletes the branch.
- Worktrees without a branch (detached HEAD) are listed in their own section.
  Only those whose folder no longer exists are pre-checked.
- Each worktree row shows whether it has uncommitted changes, whether its
  folder is missing, and, for detached worktrees, how many commits aren't on
  any branch, tag, or remote branch. Removing such a worktree loses those
  commits and changes, so these rows are never pre-checked, even when the
  branch is merged. Selecting one force-removes it without asking again.
- Locked worktrees are listed with their lock reason and never pre-checked.
  Selecting one unlocks it before removal; if removal then fails, the lock is
  restored with its original reason. A locked worktree whose folder is missing
  is flagged as possibly living on a disconnected drive.
- Branches checked out in the main worktree, or in the worktree you run the
  tool from, can't be selected.

### Options

| Flag | Description |
|---|---|
| `--base <branch>` | Base branch used for merge-status detection (default: auto-detected `main`/`master`) |
| `--protect <branch>` | Additional branch to exclude from selection (repeatable) |
| `--dry-run` | Show what would be deleted without deleting anything |
| `--force` | Skip the per-branch confirmation for not-yet-merged branches (force-deletes them) |
| `-h`, `--help` | Show help text |

## Development

```bash
npm run dev    # tsc --watch
npm run build  # one-off build to dist/
npm run playground [-- <dir>]  # sandbox repo with branches and worktrees in every state
```

The playground defaults to `git-branch-cleanup-playground` in the system temp
directory and prints what each branch and worktree is meant to demonstrate.
Run it again to reset the sandbox. It only deletes a folder it created itself.
