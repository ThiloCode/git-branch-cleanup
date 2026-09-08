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
}

export interface DeleteResult {
  name: string;
  status: "deleted" | "failed";
  error?: string;
}
