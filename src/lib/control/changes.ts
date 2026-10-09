// What the control screen may write to a calendar event, and how it is written: only the board's own
// description lines change ("Status:", "Deposit:", …); the title, time, address and other lines stay as they are.

import { descriptionLines } from "@/lib/parse/event";
import type { Check, Status } from "@/lib/types";
import type { ControlUser } from "./users";

/** Description line label → values the screen offers, as written in the event (docs/CALENDAR-GUIDE.md). */
export const FIELDS = {
  Status: ["Scheduled", "In progress", "Issue", "Done", "Postponed"],
  Deposit: ["OK", "PENDING"],
  Permit: ["OK", "PENDING", "N/A"],
  Material: ["OK", "PENDING"],
  Confirm48: ["SENT", "PENDING"],
  Note: null, // free text
} as const;

export type Field = keyof typeof FIELDS;
export type Changes = Partial<Record<Field, string>>;

export const NOTE_MAX = 200;
/** Crew leads change only these; the office changes everything (deposit is D-003, office only). */
const LEAD_FIELDS: Field[] = ["Status", "Note"];

export class ChangeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403,
  ) {
    super(message);
  }
}

/** Checks a change request against the allowed values and the user's role. Returns the cleaned changes. */
export function validateChanges(input: unknown, user: ControlUser): Changes {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ChangeError("No changes", 400);
  const out: Changes = {};
  for (const [field, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(field in FIELDS)) throw new ChangeError(`Unknown field "${field}"`, 400);
    const f = field as Field;
    if (!user.office && !LEAD_FIELDS.includes(f)) throw new ChangeError(`Only the office can change ${f}`, 403);
    if (typeof raw !== "string") throw new ChangeError(`${f} must be text`, 400);
    const allowed = FIELDS[f];
    if (allowed === null) {
      out[f] = raw.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
    } else if ((allowed as readonly string[]).includes(raw)) {
      out[f] = raw;
    } else {
      throw new ChangeError(`${f} must be one of: ${allowed.join(", ")}`, 400);
    }
  }
  if (Object.keys(out).length === 0) throw new ChangeError("No changes", 400);
  return out;
}

const STATUS_LABEL: Record<Status, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  issue: "Issue",
  completed: "Done",
  postponed: "Postponed",
};

/** Current values as the screen shows them (unknown checks have no value yet). */
export function currentValues(job: {
  status: Status;
  deposit: Check;
  permit: Check;
  material: Check;
  confirm48: Check;
  note?: string;
}): Partial<Record<Field, string>> {
  const check = (c: Check, ok: string) => (c === "ok" ? ok : c === "missing" ? "PENDING" : undefined);
  return {
    Status: STATUS_LABEL[job.status],
    Deposit: check(job.deposit, "OK"),
    Permit: check(job.permit, "OK"),
    Material: check(job.material, "OK"),
    Confirm48: check(job.confirm48, "SENT"),
    Note: job.note ?? "",
  };
}

const KEY = /^\s*([A-Za-z0-9 ]+?)\s*:/;
const norm = (k: string) => k.toLowerCase().replace(/\s+/g, "");

/** Google descriptions may be HTML: keep each link's address next to its text when converting to lines. */
function htmlToLines(html: string): string[] {
  const withLinks = html.replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
    const t = text.replace(/<[^>]+>/g, "").trim();
    return t && t !== href ? `${t} (${href})` : href;
  });
  return descriptionLines(withLinks);
}

/**
 * Writes the changed lines into an event description, plus an "Updated:" line saying who and when.
 * An existing line is replaced where it is; a new one goes before "Updated:" (or at the end).
 */
export function applyChanges(description: string | undefined, changes: Changes, updated: string): string {
  const desc = description ?? "";
  const lines = /<[a-z][\s\S]*>/i.test(desc) ? htmlToLines(desc) : desc.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();

  const set = (label: string, value: string) => {
    const line = value ? `${label}: ${value}` : `${label}:`;
    const i = lines.findIndex((l) => norm(l.match(KEY)?.[1] ?? "") === norm(label));
    if (i >= 0) {
      lines[i] = line;
      return;
    }
    const at = lines.findIndex((l) => norm(l.match(KEY)?.[1] ?? "") === "updated");
    lines.splice(at >= 0 ? at : lines.length, 0, line);
  };

  for (const [field, value] of Object.entries(changes) as [Field, string][]) set(field, value);
  set("Updated", updated);
  return lines.join("\n");
}
