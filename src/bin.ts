#!/usr/bin/env node
import pc from "picocolors";
import { worktreeLabel } from "./format.js";
import { deleteBranch, isRemovable, loadBranches, removeWorktree } from "./git.js";
import { withSpinner } from "./spinner.js";
import type { BranchInfo, DeleteResult, WorktreeInfo } from "./types.js";

const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "develop"];

interface CliOptions {
  base?: string;
  protect: string[];
  dryRun: boolean;
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { protect: [], dryRun: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--base":
        options.base = argv[++i];
        break;
      case "--protect":
        options.protect.push(argv[++i]);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`git-branch-cleanup

Interactively review and delete local git branches and their worktrees.

Usage:
  git-branch-cleanup [options]

Options:
  --base <branch>     Base branch for merge-status detection (default: auto-detected main/master)
  --protect <branch>  Additional branch to exclude from selection (repeatable)
  --dry-run           Show what would be deleted without deleting anything
  --force             Skip the per-branch confirmation when a branch isn't fully merged (uses -D)
  -h, --help          Show this help text`);
}

function printSummary(results: DeleteResult[]): void {
  const deleted = results.filter((r) => r.status === "deleted");
  const failed = results.filter((r) => r.status === "failed");

  console.log("");
  if (deleted.length > 0) {
    console.log(pc.green(`Deleted ${deleted.length} item(s):`));
    for (const r of deleted) {
      console.log(`  ${pc.green("✓")} ${r.name}`);
    }
  }
  if (failed.length > 0) {
    console.log(pc.red(`Skipped ${failed.length} item(s):`));
    for (const r of failed) {
      console.log(`  ${pc.red("✗")} ${r.name} — ${r.error}`);
    }
  }
}

function isBlockedByWorktree(branch: BranchInfo): boolean {
  return branch.worktree !== undefined && !branch.worktree.isCurrent && !isRemovable(branch.worktree);
}

async function removeWorktreeWithSpinner(worktree: WorktreeInfo): Promise<DeleteResult> {
  const label = worktreeLabel(worktree.path);
  const result = await withSpinner(`Removing ${label}...`, () => removeWorktree(worktree));
  return { ...result, name: label };
}

async function deleteBranchWithFallback(
  name: string,
  force: boolean,
  confirmForceDelete: (name: string) => Promise<boolean>,
): Promise<DeleteResult> {
  const result = await withSpinner(`Deleting ${name}...`, () => deleteBranch(name, false));
  if (result.status === "deleted" || !(force || (await confirmForceDelete(name)))) {
    return result;
  }
  return withSpinner(`Force-deleting ${name}...`, () => deleteBranch(name, true));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const [{ branches: allBranches, detachedWorktrees, baseBranch }, ui] = await withSpinner(
    "Loading branches...",
    () => Promise.all([loadBranches(options.base), import("./ui.js")]),
  );
  const { confirmDeletion, confirmForceDelete, promptCleanupSelection } = ui;

  const protectedBranches = new Set([
    ...DEFAULT_PROTECTED_BRANCHES,
    ...(baseBranch ? [baseBranch] : []),
    ...options.protect,
  ]);

  if (allBranches.length === 0 && detachedWorktrees.length === 0) {
    console.log("No local branches found.");
    return;
  }

  if (baseBranch) {
    console.log(pc.dim(`Base branch for merge detection: ${baseBranch}`));
  } else {
    console.log(
      pc.yellow(
        "Could not auto-detect a base branch (main/master); merge status will not be shown. Pass --base <branch> to enable it.",
      ),
    );
  }

  const current = allBranches.find((branch) => branch.isCurrent);
  const others = allBranches.filter((branch) => !branch.isCurrent);
  const excludedProtected = others.filter((branch) => protectedBranches.has(branch.name));
  const blockedByWorktree = others.filter(
    (branch) => !protectedBranches.has(branch.name) && isBlockedByWorktree(branch),
  );
  const eligible = others.filter(
    (branch) => !protectedBranches.has(branch.name) && !isBlockedByWorktree(branch),
  );
  const eligibleWorktrees = detachedWorktrees.filter(isRemovable);

  if (excludedProtected.length > 0) {
    console.log(pc.dim(`Protected (not shown): ${excludedProtected.map((b) => b.name).join(", ")}`));
  }
  if (blockedByWorktree.length > 0) {
    console.log(
      pc.dim(
        `Checked out in the main or a locked worktree (not shown): ${blockedByWorktree.map((b) => b.name).join(", ")}`,
      ),
    );
  }

  if (eligible.length === 0 && eligibleWorktrees.length === 0) {
    console.log("No branches or worktrees available for deletion.");
    return;
  }

  const selected = await promptCleanupSelection(
    current ? [current, ...eligible] : eligible,
    eligibleWorktrees,
  );

  if (selected.length === 0) {
    console.log("Nothing selected. Exiting.");
    return;
  }

  const proceed = await confirmDeletion(selected);
  if (!proceed) {
    console.log("Aborted.");
    return;
  }

  if (options.dryRun) {
    console.log(pc.yellow("Dry run: nothing was deleted."));
    return;
  }

  const results: DeleteResult[] = [];
  for (const target of selected) {
    if (target.worktree) {
      const removal = await removeWorktreeWithSpinner(target.worktree);
      results.push(removal);
      if (removal.status === "failed") {
        continue;
      }
    }
    if (target.kind === "branch") {
      results.push(await deleteBranchWithFallback(target.name, options.force, confirmForceDelete));
    }
  }

  printSummary(results);
}

main().catch((error: unknown) => {
  console.error(pc.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
