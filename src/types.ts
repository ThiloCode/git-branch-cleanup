export interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  isMain: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  isMissing: boolean;
  hasUncommittedChanges: boolean;
  commitsNotOnAnyBranch: number;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isMerged: boolean;
  lastCommitRelativeDate: string;
  lastCommitDate: Date;
  aheadBehind?: {
    ahead: number;
    behind: number;
  };
  worktree?: WorktreeInfo;
}

export type CleanupTarget =
  | { kind: "branch"; name: string; worktree?: WorktreeInfo }
  | { kind: "worktree"; worktree: WorktreeInfo };

export interface DeleteResult {
  name: string;
  status: "deleted" | "failed";
  error?: string;
}
