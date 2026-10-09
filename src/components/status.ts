import type { Status } from "@/lib/types";

/** CSS class suffix used by the prototype styles (s-*, c-*, count.*). */
export function statusKey(s: Status): "progress" | "scheduled" | "issue" | "done" | "postponed" {
  switch (s) {
    case "in_progress":
      return "progress";
    case "completed":
      return "done";
    default:
      return s;
  }
}

export const STATUS_LABEL: Record<Status, string> = {
  in_progress: "In progress",
  scheduled: "Scheduled",
  issue: "Issue",
  completed: "Completed",
  postponed: "Postponed",
};
