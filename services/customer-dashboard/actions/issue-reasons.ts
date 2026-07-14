export type IssueReasonCode = "DAMAGED" | "WRONG_ITEM" | "MISSING_ITEM" | "QUALITY" | "INCOMPLETE_ORDER" | "OTHER";
export const ISSUE_REASON_OPTIONS: Array<{ value: IssueReasonCode; label: string; requiresDescription: boolean }> = [
  { value: "DAMAGED", label: "Damaged item", requiresDescription: false },
  { value: "WRONG_ITEM", label: "Wrong item received", requiresDescription: false },
  { value: "MISSING_ITEM", label: "Missing item", requiresDescription: false },
  { value: "QUALITY", label: "Quality issue", requiresDescription: false },
  { value: "INCOMPLETE_ORDER", label: "Incomplete order", requiresDescription: false },
  { value: "OTHER", label: "Other issue", requiresDescription: true },
];
export const ISSUE_DESCRIPTION_MIN_LENGTH = 5;
export const ISSUE_DESCRIPTION_MAX_LENGTH = 1000;
export function isIssueReasonCode(value: string): value is IssueReasonCode { return ISSUE_REASON_OPTIONS.some((o) => o.value === value); }
