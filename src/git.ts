import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { BranchInfo, DeleteResult, WorktreeInfo } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { encoding: "utf-8" });
  // trimEnd only: a leading %(HEAD) atom legitimately outputs a plain space
  // for non-current branches, and a full trim() would eat that off the
  // start of the first line, shifting the tab-separated fields.
  return stdout.trimEnd();
}

async function gitInRepository(args: string[]): Promise<string> {
  try {
    return await git(args);
  } catch (error) {
    throw new Error(
      `Not inside a git repository, or git is not available: ${extractGitErrorMessage(error)}`,
    );
  }
}

interface RefSummary {
  name: string;
  isCurrent: boolean;
}

async function listRefSummaries(): Promise<RefSummary[]> {
  const output = await gitInRepository([
    "for-each-ref",
    "--format=%(refname:short)%09%(HEAD)",
    "refs/heads",
  ]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, head] = line.split("\t");
      return { name, isCurrent: head === "*" };
    });
}

interface WorktreeEntry {
  path: string;
  head: string;
  branch?: string;
  isBare: boolean;
  isLocked: boolean;
  lockReason?: string;
}

function parseWorktreeList(output: string): WorktreeEntry[] {
  return output
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const entry: WorktreeEntry = { path: "", head: "", isBare: false, isLocked: false };
      for (const line of block.split("\n")) {
        const separator = line.indexOf(" ");
        const key = separator === -1 ? line : line.slice(0, separator);
        const value = separator === -1 ? "" : line.slice(separator + 1);
        switch (key) {
          case "worktree":
            entry.path = value;
            break;
          case "HEAD":
            entry.head = value;
            break;
          case "branch":
            entry.branch = value.replace(/^refs\/heads\//, "");
            break;
          case "bare":
            entry.isBare = true;
            break;
          case "locked":
            entry.isLocked = true;
            entry.lockReason = value || undefined;
            break;
        }
      }
      return entry;
    });
}

function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => {
    const resolved = path.resolve(p);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

async function listWorktrees(): Promise<WorktreeInfo[]> {
  const [output, currentRoot] = await Promise.all([
    gitInRepository(["worktree", "list", "--porcelain"]),
    git(["rev-parse", "--show-toplevel"]).catch(() => undefined),
  ]);
  return parseWorktreeList(output).flatMap((entry, index): WorktreeInfo[] =>
    entry.isBare
      ? []
      : [
          {
            path: entry.path,
            head: entry.head,
            branch: entry.branch,
            isMain: index === 0,
            isCurrent: currentRoot !== undefined && samePath(entry.path, currentRoot),
            isLocked: entry.isLocked,
            lockReason: entry.lockReason,
            isMissing: !existsSync(entry.path),
            hasUncommittedChanges: false,
            commitsNotOnAnyBranch: 0,
          },
        ],
  );
}

export function isRemovable(worktree: WorktreeInfo): boolean {
  return !worktree.isMain && !worktree.isCurrent;
}

async function inspectWorktree(worktree: WorktreeInfo): Promise<WorktreeInfo> {
  if (!isRemovable(worktree)) {
    return worktree;
  }
  const [status, commitCount] = await Promise.all([
    // If status itself fails we report the worktree as clean: removal then
    // runs without --force, so git still refuses to drop real changes.
    worktree.isMissing
      ? ""
      : git(["-C", worktree.path, "status", "--porcelain"]).catch(() => ""),
    worktree.branch
      ? "0"
      : git(["rev-list", "--count", worktree.head, "--not", "--branches", "--tags", "--remotes"]),
  ]);
  return {
    ...worktree,
    hasUncommittedChanges: status !== "",
    commitsNotOnAnyBranch: Number(commitCount),
  };
}

export function detectBaseBranch(
  names: readonly string[],
  candidates: readonly string[] = ["main", "master"],
): string | undefined {
  const set = new Set(names);
  return candidates.find((candidate) => set.has(candidate));
}

export interface LoadBranchesResult {
  branches: BranchInfo[];
  detachedWorktrees: WorktreeInfo[];
  baseBranch?: string;
}

/**
 * Uses a fixed number of `git` calls per phase regardless of branch count.
 * Phase one lists ref names (also detects the current branch and doubles as
 * the "inside a git repo" check) and worktrees. Phase two runs one batched
 * for-each-ref that pulls commit dates and ahead/behind-vs-base for every
 * branch at once via the `%(ahead-behind:...)` atom, in parallel with one
 * status check per removable worktree.
 */
export async function loadBranches(baseBranchOverride?: string): Promise<LoadBranchesResult> {
  const [refs, worktrees] = await Promise.all([listRefSummaries(), listWorktrees()]);
  const names = refs.map((ref) => ref.name);
  const baseBranch = baseBranchOverride ?? detectBaseBranch(names);
  const currentName = refs.find((ref) => ref.isCurrent)?.name;

  const fields = ["%(refname:short)", "%(committerdate:relative)", "%(committerdate:iso-strict)"];
  if (baseBranch) {
    fields.push(`%(ahead-behind:refs/heads/${baseBranch})`);
  }
  const [output, inspectedWorktrees] = await Promise.all([
    git(["for-each-ref", `--format=${fields.join("%09")}`, "refs/heads"]),
    Promise.all(worktrees.map(inspectWorktree)),
  ]);
  const worktreesByBranch = new Map(
    inspectedWorktrees.flatMap((worktree) => (worktree.branch ? [[worktree.branch, worktree]] : [])),
  );

  const branches = output
    .split("\n")
    .filter(Boolean)
    .map((line): BranchInfo => {
      const [name, relativeDate, isoDate, aheadBehindRaw] = line.split("\t");
      const info: BranchInfo = {
        name,
        isCurrent: name === currentName,
        isMerged: false,
        lastCommitRelativeDate: relativeDate,
        lastCommitDate: new Date(isoDate),
        worktree: worktreesByBranch.get(name),
      };
      if (baseBranch && aheadBehindRaw) {
        const [ahead, behind] = aheadBehindRaw.trim().split(/\s+/).map(Number);
        info.isMerged = ahead === 0;
        if (name !== baseBranch) {
          info.aheadBehind = { ahead, behind };
        }
      }
      return info;
    });

  return {
    branches,
    detachedWorktrees: inspectedWorktrees.filter((worktree) => !worktree.branch),
    baseBranch,
  };
}

export async function deleteBranch(name: string, force: boolean): Promise<DeleteResult> {
  try {
    await git(["branch", force ? "-D" : "-d", name]);
    return { name, status: "deleted" };
  } catch (error) {
    return { name, status: "failed", error: extractGitErrorMessage(error) };
  }
}

/**
 * Unlocks a locked worktree first instead of using `remove -f -f`, which
 * would also discard uncommitted changes without checking. If removal then
 * fails, the lock is restored with its original reason.
 */
export async function removeWorktree(worktree: WorktreeInfo): Promise<DeleteResult> {
  const force = worktree.hasUncommittedChanges ? ["--force"] : [];
  try {
    if (worktree.isLocked) {
      await git(["worktree", "unlock", worktree.path]);
    }
    try {
      await git(["worktree", "remove", ...force, worktree.path]);
    } catch (error) {
      if (worktree.isLocked) {
        const reason = worktree.lockReason ? ["--reason", worktree.lockReason] : [];
        await git(["worktree", "lock", ...reason, worktree.path]).catch(() => undefined);
      }
      throw error;
    }
    return { name: worktree.path, status: "deleted" };
  } catch (error) {
    return { name: worktree.path, status: "failed", error: extractGitErrorMessage(error) };
  }
}

function extractGitErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    if (stderr) return stderr.toString().trim();
  }
  return error instanceof Error ? error.message : String(error);
}
