# git-branch-cleanup

Interactive CLI to review and delete local git branches. Navigate with the
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
```
