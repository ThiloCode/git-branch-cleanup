import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = ".git-branch-cleanup-playground";
const root = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "git-branch-cleanup-playground"));
const repo = path.join(root, "repo");

function prepareRoot() {
  if (existsSync(root)) {
    if (!existsSync(path.join(root, MARKER)) && readdirSync(root).length > 0) {
      console.error(`${root} exists, is not empty, and was not created by this script. Refusing to touch it.`);
      process.exit(1);
    }
    rmSync(root, { recursive: true, force: true });
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, MARKER), "");
}

function git(cwd, args, daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim();
}

function commit(cwd, file, message, daysAgo) {
  writeFileSync(path.join(cwd, file), `${message}\n`, { flag: "a" });
  git(cwd, ["add", file]);
  git(cwd, ["commit", "-q", "-m", message], daysAgo);
}

function branchWithCommits(name, from, commits) {
  git(repo, ["switch", "-q", "-c", name, from]);
  for (const [file, message, daysAgo] of commits) {
    commit(repo, file, message, daysAgo);
  }
  git(repo, ["switch", "-q", "main"]);
}

function merge(name, daysAgo) {
  git(repo, ["merge", "-q", "--no-ff", "-m", `Merge ${name}`, name], daysAgo);
}

function worktree(name, ...args) {
  const target = path.join(root, name);
  git(repo, ["worktree", "add", "-q", ...args.slice(0, -1), target, ...args.slice(-1)]);
  return target;
}

prepareRoot();
mkdirSync(repo);
git(repo, ["init", "-q", "-b", "main"]);
git(repo, ["config", "user.name", "Playground"]);
git(repo, ["config", "user.email", "playground@example.com"]);
git(repo, ["config", "commit.gpgsign", "false"]);

commit(repo, "README.md", "Initial commit", 120);
commit(repo, "app.txt", "Add app skeleton", 118);
branchWithCommits("wip/old-idea", "main", [["idea.txt", "Sketch an idea that went nowhere", 110]]);
commit(repo, "app.txt", "Add routing", 60);

branchWithCommits("fix/typo-readme", "main", [["README.md", "Fix typo in README", 25]]);
merge("fix/typo-readme", 21);
branchWithCommits("feature/login-form", "main", [
  ["login.txt", "Add login form", 15],
  ["login.txt", "Validate login form", 14],
]);
merge("feature/login-form", 12);
branchWithCommits("feature/payments", "main", [["payments.txt", "Add payments", 9]]);
merge("feature/payments", 8);
git(repo, ["branch", "develop"]);

branchWithCommits("experiment/new-parser", "main", [["parser.txt", "Try a new parser", 7]]);
branchWithCommits("feature/search", "main", [
  ["search.txt", "Add search index", 6],
  ["search.txt", "Add search UI", 5],
]);
branchWithCommits("bugfix/crash", "main", [["app.txt", "Fix crash on startup", 4]]);
branchWithCommits("release/1.0", "main", [["CHANGELOG.md", "Prepare 1.0", 3]]);
commit(repo, "app.txt", "Add settings page", 2.5);
commit(repo, "app.txt", "Add logging", 2);
branchWithCommits("feature/dark-mode", "main", [
  ["theme.txt", "Add dark palette", 1.5],
  ["theme.txt", "Toggle theme in settings", 1],
  ["theme.txt", "Persist theme choice", 0.1],
]);

worktree("payments", "feature/payments");

const search = worktree("search", "feature/search");
writeFileSync(path.join(search, "search.txt"), "half-finished edit\n", { flag: "a" });
writeFileSync(path.join(search, "notes.txt"), "untracked notes\n");

rmSync(worktree("crash", "bugfix/crash"), { recursive: true, force: true });

worktree("release-1.0", "release/1.0");
git(repo, ["worktree", "lock", "--reason", "release in progress", path.join(root, "release-1.0")]);

const review = worktree("review-pr-42", "--detach", "experiment/new-parser");
commit(review, "parser.txt", "Review fixup, never pushed anywhere", 0.5);
writeFileSync(path.join(review, "scratch.txt"), "review notes\n");

worktree("scratch", "--detach", "main");

rmSync(worktree("old-checkout", "--detach", "main~3"), { recursive: true, force: true });

console.log(`Playground created in ${root}

Try it:
  cd "${repo}"
  git-branch-cleanup --dry-run      (or: node "${fileURLToPath(new URL("../dist/bin.js", import.meta.url))}" --dry-run)

What's in it:
  main, develop                 protected, not selectable
  fix/typo-readme               merged                          -> pre-checked
  feature/login-form            merged                          -> pre-checked
  feature/payments              merged, clean worktree          -> pre-checked, removes ../payments
  feature/dark-mode             3 ahead                         -> -d fails, asks to force-delete
  experiment/new-parser         1 ahead, 2 behind
  wip/old-idea                  1 ahead, ~4 months old
  feature/search                worktree with uncommitted changes (never pre-checked)
  bugfix/crash                  worktree folder deleted by hand
  release/1.0                   locked worktree, not selectable
  review-pr-42 (detached)       1 commit on no branch + untracked file (never pre-checked)
  scratch (detached)            clean
  old-checkout (detached)       folder deleted by hand          -> pre-checked

Run this script again to reset everything.`);
