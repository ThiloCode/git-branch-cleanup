import { checkbox, confirm, Separator } from "@inquirer/prompts";
import pc from "picocolors";
import type { BranchInfo } from "./types.js";

function formatChoiceLabel(branch: BranchInfo): string {
  const details: string[] = [];
  if (branch.isMerged) {
    details.push(pc.green("merged"));
  } else if (branch.aheadBehind) {
    const { ahead, behind } = branch.aheadBehind;
    details.push(pc.yellow(`${ahead} ahead, ${behind} behind`));
  }
  details.push(pc.dim(branch.lastCommitRelativeDate));
  return `${branch.name}  ${pc.dim("·")}  ${details.join(pc.dim(" · "))}`;
}

export async function promptBranchSelection(branches: BranchInfo[]): Promise<string[]> {
  const current = branches.find((branch) => branch.isCurrent);
  const selectable = branches.filter((branch) => !branch.isCurrent);

  if (selectable.length === 0) {
    return [];
  }

  const choices = [
    ...(current
      ? [new Separator(pc.dim(`(current branch, not selectable: ${current.name})`))]
      : []),
    ...selectable.map((branch) => ({
      name: formatChoiceLabel(branch),
      value: branch.name,
      checked: branch.isMerged,
    })),
  ];

  return checkbox({
    message: "Select branches to delete (space to toggle, enter to confirm)",
    choices,
    pageSize: 20,
    loop: false,
  });
}

export async function confirmDeletion(selected: string[]): Promise<boolean> {
  if (selected.length === 0) {
    return false;
  }

  console.log("");
  console.log(pc.bold(`About to delete ${selected.length} branch(es):`));
  for (const name of selected) {
    console.log(`  ${pc.red("-")} ${name}`);
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
