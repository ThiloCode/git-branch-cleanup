#!/usr/bin/env node
import pc from "picocolors";
import { deleteBranch, loadBranches } from "./git.js";
import { confirmDeletion, confirmForceDelete, promptBranchSelection } from "./ui.js";
import type { DeleteResult } from "./types.js";

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

Interactively review and delete local git branches.

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
    console.log(pc.green(`Deleted ${deleted.length} branch(es):`));
    for (const r of deleted) {
      console.log(`  ${pc.green("✓")} ${r.name}`);
    }
  }
  if (failed.length > 0) {
    console.log(pc.red(`Skipped ${failed.length} branch(es):`));
    for (const r of failed) {
      console.log(`  ${pc.red("✗")} ${r.name} — ${r.error}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const { branches: allBranches, baseBranch } = await loadBranches(options.base);

  const protectedBranches = new Set([
    ...DEFAULT_PROTECTED_BRANCHES,
    ...(baseBranch ? [baseBranch] : []),
    ...options.protect,
  ]);

  if (allBranches.length === 0) {
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
  const eligible = allBranches.filter(
    (branch) => !branch.isCurrent && !protectedBranches.has(branch.name),
  );
  const excludedProtected = allBranches.filter(
    (branch) => !branch.isCurrent && protectedBranches.has(branch.name),
  );

  if (excludedProtected.length > 0) {
    console.log(pc.dim(`Protected (not shown): ${excludedProtected.map((b) => b.name).join(", ")}`));
  }

  if (eligible.length === 0) {
    console.log("No branches available for deletion.");
    return;
  }

  const selected = await promptBranchSelection(current ? [current, ...eligible] : eligible);

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
    console.log(pc.yellow("Dry run: no branches were deleted."));
    return;
  }

  const results: DeleteResult[] = [];
  for (const name of selected) {
    let result = await deleteBranch(name, false);
    if (result.status === "failed") {
      const shouldForce = options.force || (await confirmForceDelete(name));
      if (shouldForce) {
        result = await deleteBranch(name, true);
      }
    }
    results.push(result);
  }

  printSummary(results);
}

main().catch((error: unknown) => {
  console.error(pc.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
