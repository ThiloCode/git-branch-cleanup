import { checkbox, confirm, Separator } from "@inquirer/prompts";
import pc from "picocolors";
import { worktreeLabel } from "./format.js";
import type { BranchInfo, CleanupTarget, WorktreeInfo } from "./types.js";

function lossWarnings(worktree: WorktreeInfo): string[] {
  const warnings: string[] = [];
  if (worktree.commitsNotOnAnyBranch > 0) {
    warnings.push(`${worktree.commitsNotOnAnyBranch} commit(s) not on any branch`);
  }
  if (worktree.hasUncommittedChanges) {
    warnings.push("uncommitted changes");
  }
  return warnings;
}

function lockNote(worktree: WorktreeInfo): string | undefined {
  if (!worktree.isLocked) {
    return undefined;
  }
  return worktree.lockReason ? `locked: ${worktree.lockReason}` : "locked";
}

function worktreeDetails(worktree: WorktreeInfo): string[] {
  const lock = lockNote(worktree);
  return [
    ...(lock ? [pc.yellow(lock)] : []),
    ...(worktree.isMissing && worktree.isLocked
      ? [pc.red("folder missing (possibly on a disconnected drive)")]
      : worktree.isMissing
        ? [pc.dim("folder missing")]
        : []),
    ...lossWarnings(worktree).map((warning) => pc.red(warning)),
  ];
}

function formatBranchLabel(branch: BranchInfo): string {
  const details: string[] = [];
  if (branch.isMerged) {
    details.push(pc.green("merged"));
  } else if (branch.aheadBehind) {
    const { ahead, behind } = branch.aheadBehind;
    details.push(pc.yellow(`${ahead} ahead, ${behind} behind`));
  }
  if (branch.worktree) {
    details.push(pc.cyan(worktreeLabel(branch.worktree.path)), ...worktreeDetails(branch.worktree));
  }
  details.push(pc.dim(branch.lastCommitRelativeDate));
  return `${branch.name}  ${pc.dim("·")}  ${details.join(pc.dim(" · "))}`;
}

function formatWorktreeLabel(worktree: WorktreeInfo): string {
  const details = [pc.dim(`detached at ${worktree.head.slice(0, 7)}`), ...worktreeDetails(worktree)];
  return `${worktreeLabel(worktree.path)}  ${pc.dim("·")}  ${details.join(pc.dim(" · "))}`;
}

function requiresDeliberateChoice(worktree: WorktreeInfo | undefined): boolean {
  return worktree !== undefined && (worktree.isLocked || lossWarnings(worktree).length > 0);
}

export async function promptCleanupSelection(
  branches: BranchInfo[],
  worktrees: WorktreeInfo[],
): Promise<CleanupTarget[]> {
  const current = branches.find((branch) => branch.isCurrent);
  const selectable = branches.filter((branch) => !branch.isCurrent);

  if (selectable.length === 0 && worktrees.length === 0) {
    return [];
  }

  const choices = [
    ...(current
      ? [new Separator(pc.dim(`(current branch, not selectable: ${current.name})`))]
      : []),
    ...selectable.map((branch) => ({
      name: formatBranchLabel(branch),
      short: branch.name,
      value: { kind: "branch", name: branch.name, worktree: branch.worktree } as CleanupTarget,
      checked: branch.isMerged && !requiresDeliberateChoice(branch.worktree),
    })),
    ...(worktrees.length > 0 ? [new Separator(pc.dim("── Worktrees without a branch ──"))] : []),
    ...worktrees.map((worktree) => ({
      name: formatWorktreeLabel(worktree),
      short: worktreeLabel(worktree.path),
      value: { kind: "worktree", worktree } as CleanupTarget,
      checked: worktree.isMissing && !requiresDeliberateChoice(worktree),
    })),
  ];

  return checkbox({
    message: "Select branches and worktrees to delete (space to toggle, enter to confirm)",
    choices,
    pageSize: 20,
    loop: false,
  });
}

function formatTargetSummary(target: CleanupTarget): string {
  const worktree = target.worktree;
  const label =
    target.kind === "branch"
      ? target.name + (worktree ? pc.dim(` and ${worktreeLabel(worktree.path)}`) : "")
      : worktreeLabel(target.worktree.path);
  const lock = worktree && lockNote(worktree);
  const warnings = worktree ? lossWarnings(worktree) : [];
  return [
    label,
    ...(lock ? [pc.yellow(`(${lock}, will be unlocked)`)] : []),
    ...(warnings.length > 0 ? [pc.red(`(${warnings.join(", ")} will be lost)`)] : []),
  ].join(" ");
}

export async function confirmDeletion(selected: CleanupTarget[]): Promise<boolean> {
  if (selected.length === 0) {
    return false;
  }

  console.log("");
  console.log(pc.bold(`About to delete ${selected.length} item(s):`));
  for (const target of selected) {
    console.log(`  ${pc.red("-")} ${formatTargetSummary(target)}`);
  }
  console.log("");

  return confirm({ message: "Proceed?", default: false });
}

export async function confirmForceDelete(name: string): Promise<boolean> {
  return confirm({
    message: `"${name}" is not fully merged into the base branch. Force delete anyway?`,
    default: false,
  });
}
