import path from "node:path";

export function worktreeRelativePath(worktreePath: string): string {
  return path.relative(process.cwd(), worktreePath) || ".";
}

export function worktreeLabel(worktreePath: string): string {
  return `worktree ${worktreeRelativePath(worktreePath)}`;
}
