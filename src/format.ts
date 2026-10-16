import path from "node:path";

export function worktreeLabel(worktreePath: string): string {
  return `worktree ${path.relative(process.cwd(), worktreePath) || "."}`;
}
