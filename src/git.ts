import { execFileSync } from "node:child_process";
import type { BranchInfo, DeleteResult } from "./types.js";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

export function assertInsideGitRepo(): void {
  let output: string;
  try {
    output = git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error("Not inside a git repository.");
  }
  if (output !== "true") {
    throw new Error("Not inside a git repository.");
  }
}

export function getCurrentBranch(): string {
  return git(["branch", "--show-current"]);
}

function listBranchNames(): string[] {
  const output = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return output.split("\n").filter(Boolean);
}

export function detectBaseBranch(
  candidates: readonly string[] = ["main", "master"],
): string | undefined {
  const branches = new Set(listBranchNames());
  return candidates.find((candidate) => branches.has(candidate));
}

function getMergedBranchNames(baseBranch: string): Set<string> {
  const output = git(["branch", "--merged", baseBranch, "--format=%(refname:short)"]);
  return new Set(output.split("\n").filter(Boolean));
}

function getAheadBehind(branch: string, base: string): { ahead: number; behind: number } {
  const output = git(["rev-list", "--left-right", "--count", `${branch}...${base}`]);
  const [ahead, behind] = output.split(/\s+/).map(Number);
  return { ahead, behind };
}

export function listBranches(baseBranch?: string): BranchInfo[] {
  const current = getCurrentBranch();
  const format = ["%(refname:short)", "%(committerdate:relative)", "%(committerdate:iso-strict)"].join(
    "%09",
  );
  const output = git(["for-each-ref", `--format=${format}`, "refs/heads"]);
  const mergedNames = baseBranch ? getMergedBranchNames(baseBranch) : new Set<string>();

  return output
    .split("\n")
    .filter(Boolean)
    .map((line): BranchInfo => {
      const [name, relativeDate, isoDate] = line.split("\t");
      const info: BranchInfo = {
        name,
        isCurrent: name === current,
        isMerged: mergedNames.has(name),
        lastCommitRelativeDate: relativeDate,
        lastCommitDate: new Date(isoDate),
      };
      if (baseBranch && name !== baseBranch) {
        info.aheadBehind = getAheadBehind(name, baseBranch);
      }
      return info;
    });
}

export function deleteBranch(name: string, force: boolean): DeleteResult {
  try {
    git(["branch", force ? "-D" : "-d", name]);
    return { name, status: "deleted" };
  } catch (error) {
    return { name, status: "failed", error: extractGitErrorMessage(error) };
  }
}

function extractGitErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    if (stderr) return stderr.toString().trim();
  }
  return error instanceof Error ? error.message : String(error);
}
