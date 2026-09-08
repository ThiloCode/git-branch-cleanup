import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BranchInfo, DeleteResult } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { encoding: "utf-8" });
  // trimEnd only: a leading %(HEAD) atom legitimately outputs a plain space
  // for non-current branches, and a full trim() would eat that off the
  // start of the first line, shifting the tab-separated fields.
  return stdout.trimEnd();
}

interface RefSummary {
  name: string;
  isCurrent: boolean;
}

async function listRefSummaries(): Promise<RefSummary[]> {
  let output: string;
  try {
    output = await git(["for-each-ref", "--format=%(refname:short)%09%(HEAD)", "refs/heads"]);
  } catch (error) {
    throw new Error(
      `Not inside a git repository, or git is not available: ${extractGitErrorMessage(error)}`,
    );
  }
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, head] = line.split("\t");
      return { name, isCurrent: head === "*" };
    });
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
  baseBranch?: string;
}

/**
 * Fetches every local branch in two `git` calls total, regardless of branch
 * count: one to list ref names (also detects the current branch and doubles
 * as the "inside a git repo" check), one batched for-each-ref that pulls
 * commit dates and ahead/behind-vs-base for every branch at once via the
 * `%(ahead-behind:...)` atom, instead of spawning a separate `git`
 * process per branch.
 */
export async function loadBranches(baseBranchOverride?: string): Promise<LoadBranchesResult> {
  const refs = await listRefSummaries();
  const names = refs.map((ref) => ref.name);
  const baseBranch = baseBranchOverride ?? detectBaseBranch(names);
  const currentName = refs.find((ref) => ref.isCurrent)?.name;

  const fields = ["%(refname:short)", "%(committerdate:relative)", "%(committerdate:iso-strict)"];
  if (baseBranch) {
    fields.push(`%(ahead-behind:refs/heads/${baseBranch})`);
  }
  const output = await git(["for-each-ref", `--format=${fields.join("%09")}`, "refs/heads"]);

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

  return { branches, baseBranch };
}

export async function deleteBranch(name: string, force: boolean): Promise<DeleteResult> {
  try {
    await git(["branch", force ? "-D" : "-d", name]);
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
