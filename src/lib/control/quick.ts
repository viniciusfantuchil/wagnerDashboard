// The compact Job Status card and the "Needs attention" strip: pure rules, shared by the screen and its tests.
// Client-safe: no server code.

import type { Changes } from "./changes";
import type { ControlDay, ControlJob } from "./jobs";

/** The most common next change for a job, as one button: Start, Done or Resume. */
export function nextStep(status: string | undefined): { label: string; status: string } | null {
  switch (status ?? "Scheduled") {
    case "Scheduled":
      return { label: "Start", status: "In progress" };
    case "In progress":
      return { label: "Done", status: "Done" };
    case "Issue":
      return { label: "Resume", status: "In progress" };
    default:
      return null; // Done or Postponed: change from the full editor
  }
}

/** A job can be marked stopped from the compact card while it is scheduled or under way. */
export const canStop = (status: string | undefined) => status === undefined || status === "Scheduled" || status === "In progress";

/** One-tap reasons when a job is stopped; the note box takes anything else. */
export const STOP_REASONS = ["Rain", "Waiting on material", "Customer not home", "Equipment", "Permit / inspection"];

export type Tone = "ok" | "warn" | "bad" | "muted";

/** The compact card's readiness chips: always a word or symbol next to the color, never color alone. */
export function readinessChips(job: ControlJob): { field: string; label: string; tone: Tone }[] {
  const v = job.values;
  const chips: { field: string; label: string; tone: Tone }[] = [];
  const add = (field: string, label: string, tone: Tone) => chips.push({ field, label, tone });

  // D-003: a deposit that is not written down is never OK.
  if (v.Deposit === "FINAL") add("Deposit", "Final payment ✓", "ok");
  else if (v.Deposit === "OK") add("Deposit", "Deposit 50% ✓", "ok");
  else if (v.Deposit === "PENDING") add("Deposit", "Deposit pending", "bad");
  else add("Deposit", "Deposit ?", "warn");

  if (v.Permit === "APPROVED") add("Permit", "Permit ✓", "ok");
  else if (v.Permit === "N/A") add("Permit", "Permit N/A", "muted");
  else if (v.Permit === "REQUESTED") add("Permit", "Permit requested", "warn");
  else if (v.Permit === "PENDING") add("Permit", "Permit pending", "warn");
  else add("Permit", "Permit ?", "warn");

  if (v.Material === "ORDERED") add("Material", "Material ordered", "ok");
  else if (v.Material === "NOT ORDERED") add("Material", "Material not ordered", "warn");
  else add("Material", "Material ?", "warn");

  if (v.Delivery) add("Delivery", v.Delivery === "SHOWROOM" ? "To showroom" : "To job site", "muted");

  if (v.Confirm48 === "SENT") add("Confirm48", "48h ✓", "ok");
  else if (v.Confirm48 === "PENDING") add("Confirm48", "48h pending", "warn");
  else add("Confirm48", "48h ?", "warn");
  return chips;
}

export const statusTone = (status: string | undefined): string =>
  ({ "In progress": "progress", Issue: "issue", Done: "done", Postponed: "postponed" })[status ?? ""] ?? "scheduled";

/** "Needs attention" items, mirroring the TV board's alerts for today and the next workday. */
export type AttentionKey = "stopped" | "deposit" | "confirm48" | "material" | "permit";

const open = (j: ControlJob) => j.values.Status !== "Done" && j.values.Status !== "Postponed";

/** Which jobs of a day an attention item covers. `next` is true for the next workday. */
export function attentionMatch(key: AttentionKey, job: ControlJob, next: boolean): boolean {
  switch (key) {
    case "stopped":
      return job.values.Status === "Issue";
    case "deposit":
      return open(job) && job.values.Deposit !== "OK" && job.values.Deposit !== "FINAL"; // pending or unknown (D-003)
    case "confirm48":
      return next && open(job) && job.values.Confirm48 !== "SENT"; // D-007
    case "material":
      return next && open(job) && job.values.Material !== "ORDERED";
    case "permit":
      return next && open(job) && (job.values.Permit === "PENDING" || job.values.Permit === "REQUESTED"); // not approved yet
  }
}

export const ATTENTION: { key: AttentionKey; label: (n: number) => string; tone: Tone; office: boolean }[] = [
  { key: "stopped", label: (n) => `${n} stopped`, tone: "bad", office: false },
  { key: "deposit", label: (n) => `${n} deposit pending`, tone: "bad", office: true },
  { key: "confirm48", label: (n) => `${n} not confirmed (48 h)`, tone: "warn", office: true },
  { key: "material", label: (n) => `${n} material not ordered`, tone: "warn", office: true },
  { key: "permit", label: (n) => `${n} permit not approved`, tone: "warn", office: true },
];

/** Counts per item over today (first day) and the next workday; crew leads get only "stopped". */
export function attentionCounts(days: ControlDay[], office: boolean): { key: AttentionKey; count: number; label: string; tone: Tone }[] {
  return ATTENTION.filter((a) => office || !a.office)
    .map((a) => {
      const count = days.reduce((n, d, i) => n + d.jobs.filter((j) => attentionMatch(a.key, j, i > 0)).length, 0);
      return { key: a.key, count, label: a.label(count), tone: a.tone };
    })
    .filter((a) => a.count > 0);
}

/** The changes that put back what a save replaced. A check with no value before can't be un-written, so it is left out. */
export function revertOf(before: ControlJob, changes: Changes): Changes {
  const out: Changes = {};
  for (const f of Object.keys(changes) as (keyof Changes)[]) {
    const prev = before.values[f];
    if (prev !== undefined && prev !== changes[f]) out[f] = prev;
    else if (f === "Note" && prev === undefined) out[f] = "";
  }
  return out;
}
