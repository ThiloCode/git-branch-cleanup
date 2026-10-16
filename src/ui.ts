import { checkbox, confirm, Separator } from "@inquirer/prompts";
import pc from "picocolors";
import { worktreeLabel, worktreeRelativePath } from "./format.js";
import { type Column, formatTable } from "./table.js";
import type { BranchInfo, CleanupTarget, WorktreeInfo } from "./types.js";

function lossWarnings(worktree: WorktreeInfo): string[] {
  const warnings: string[] = [];
  if (worktree.commitsNotOnAnyBranch > 0) {
    const count = worktree.commitsNotOnAnyBranch;
    warnings.push(`${count} ${count === 1 ? "commit" : "commits"} not on any branch`);
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

const COLUMNS: Column[] = [
  { header: "BRANCH", minWidth: 18 },
  { header: "STATUS" },
  { header: "LAST COMMIT" },
  { header: "WORKTREE", minWidth: 8 },
  { header: "NOTES", minWidth: 5 },
];

const CHOICE_PREFIX_WIDTH = 3;
const FALLBACK_TERMINAL_WIDTH = 80;

function branchStatus(branch: BranchInfo): string {
  if (branch.isMerged) {
    return pc.green("merged");
  }
  if (branch.aheadBehind) {
    const { ahead, behind } = branch.aheadBehind;
    return pc.yellow(`${ahead} ahead, ${behind} behind`);
  }
  return "";
}

function worktreeCells(worktree: WorktreeInfo | undefined): string[] {
  if (!worktree) {
    return ["", ""];
  }
  return [pc.cyan(worktreeRelativePath(worktree.path)), worktreeDetails(worktree).join(pc.dim(", "))];
}

function branchRow(branch: BranchInfo): string[] {
  return [
    branch.name,
    branchStatus(branch),
    pc.dim(branch.lastCommitRelativeDate),
    ...worktreeCells(branch.worktree),
  ];
}

function detachedWorktreeRow(worktree: WorktreeInfo): string[] {
  return [pc.dim(`(detached ${worktree.head.slice(0, 7)})`), "", "", ...worktreeCells(worktree)];
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

  const terminalWidth = process.stdout.columns || FALLBACK_TERMINAL_WIDTH;
  const table = formatTable(
    COLUMNS,
    [...selectable.map(branchRow), ...worktrees.map(detachedWorktreeRow)],
    terminalWidth - CHOICE_PREFIX_WIDTH,
  );
  const heading = " ".repeat(CHOICE_PREFIX_WIDTH) + pc.bold(table.heading);
  const branchLabels = table.rows.slice(0, selectable.length);
  const worktreeLabels = table.rows.slice(selectable.length);

  const choices = [
    ...(current
      ? [new Separator(pc.dim(`(current branch, not selectable: ${current.name})`))]
      : []),
    ...selectable.map((branch, i) => ({
      name: branchLabels[i],
      short: branch.name,
      value: { kind: "branch", name: branch.name, worktree: branch.worktree } as CleanupTarget,
      checked: branch.isMerged && !requiresDeliberateChoice(branch.worktree),
    })),
    ...(worktrees.length > 0 ? [new Separator(pc.dim("── Worktrees without a branch ──"))] : []),
    ...worktrees.map((worktree, i) => ({
      name: worktreeLabels[i],
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
    theme: {
      style: {
        message: (text: string, status: string) => (status === "done" ? pc.bold(text) : `${pc.bold(text)}\n${heading}`),
      },
    },
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
