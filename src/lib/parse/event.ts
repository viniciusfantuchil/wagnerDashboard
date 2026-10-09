// Google Calendar event → Job | Visit, following the calendar convention in docs/SPEC-phase-1.md §6.
// Old-style events (payment written as free text in the title) are still shown, with unknown fields set to
// "unknown" and a parse warning. A deposit is never guessed as OK.

import { nyIso } from "@/lib/time";
import type { Check, Job, Status, Visit } from "@/lib/types";

/** The fields of a Google Calendar API v3 event that the board reads. */
export interface CalendarEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

export type ParsedEvent = { kind: "job"; job: Job } | { kind: "visit"; visit: Visit } | { kind: "skip"; reason: string };

/** Google Calendar event colors (colorId) → job status. No color = scheduled. */
export const COLOR_STATUS: Record<string, Status> = {
  "9": "scheduled", // Blueberry
  "5": "in_progress", // Banana
  "7": "completed", // Peacock
  "11": "issue", // Tomato
  "8": "postponed", // Graphite
};

/** All-day events have no time; they are placed in the normal workday (for weather) and shown as "All day". */
const ALL_DAY_START = "07:00";
const ALL_DAY_END = "16:00";

/** Brevard County places, longest first so "West Melbourne" wins over "Melbourne". */
const KNOWN_CITIES = [
  "Indian Harbour Beach", "Grant-Valkaria", "Satellite Beach", "Melbourne Beach", "West Melbourne", "Merritt Island",
  "Port St. John", "Cape Canaveral", "Melbourne Village", "Palm Shores", "Cocoa Beach", "Indialantic", "Titusville",
  "Rockledge", "Melbourne", "Sebastian", "Palm Bay", "Malabar", "Suntree", "Viera", "Cocoa", "Mims",
];

export const WARN = {
  deposit: "Deposit status not found",
  address: "No address",
  street: "No street address",
  city: "City not found in address",
  title: "Title not in 'Customer – Service size' format",
  payment: "Payment text in title",
  color: "Unknown event color",
} as const;

// " – ", " - " or " — " between title parts.
const SEP = /\s+[–—-]\s+/;
const ESTIMATE = /^(?:EST|Estimate)\b\s*[–—:-]?\s*/i;
/** "Stop @ Barry Schiedel": a short crew stop at a customer's. */
const STOP = /^stop\s*@\s*/i;
/** "(Morning) Pam Gonzalez": a leading time-of-day note, not part of the name. */
const LEADING_NOTE = /^\([^)]{1,20}\)\s*/;
const SIZE = /\b(\d[\d,]*(?:\.\d+)?)\s*(sq\.?\s*ft|sqft|sf|ln\.?\s*ft|lnft|lin\.?\s*ft|lf)\.?$/i;
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?k?/gi;
const PAYMENT = /\b(?:paid|unpaid|pd|deposit|dep|balance|bal|due|pending|invoice[sd]?|\d{1,3}\s?%)(?=\W|$)\.?/gi;

/** Removes dollar amounts and payment words, which must never reach the screen. */
function scrubPayment(text: string): { text: string; found: boolean } {
  const cleaned = text.replace(MONEY, " ").replace(PAYMENT, " ");
  const tidy = cleaned
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s–—:|/-]+|[\s–—:|/-]+$/g, "")
    .trim();
  return { text: tidy, found: tidy !== text.trim() };
}

function scrubMoney(text: string): string {
  return text.replace(MONEY, "").replace(/\s{2,}/g, " ").trim();
}

/** Google descriptions may be HTML. Returns plain-text lines. */
export function descriptionLines(description = ""): string[] {
  return description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** `Key: Value` lines, keys lower-cased. The first occurrence of a key wins. */
export function descriptionFields(description?: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of descriptionLines(description)) {
    const m = line.match(/^([A-Za-z0-9 ]+?)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase().replace(/\s+/g, "");
    if (!fields.has(key)) fields.set(key, m[2].trim());
  }
  return fields;
}

/** Reads a status key. Missing key = unknown; an unrecognized value = unknown plus a warning. */
function readCheck(
  fields: Map<string, string>,
  key: string,
  label: string,
  values: Record<string, Check>,
  warnings: string[],
): Check {
  const raw = fields.get(key);
  if (raw === undefined || raw === "") return "unknown";
  const v = values[raw.toUpperCase().replace(/\s+/g, "")];
  if (v) return v;
  warnings.push(`Unrecognized ${label} value "${scrubMoney(raw)}"`);
  return "unknown";
}

/** "1234 Example Dr, Viera, FL 32940" → city "Viera". Falls back to known Brevard places. */
export function parseLocation(location?: string): { address: string; city: string; warnings: string[] } {
  const address = (location ?? "").trim();
  if (!address) return { address: "", city: "", warnings: [WARN.address] };

  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(USA|US|United States)$/i.test(p));
  const stateAt = parts.findIndex((p, i) => i > 0 && /^(FL|Florida)\b/i.test(p));
  const known = KNOWN_CITIES.find((c) => new RegExp(`\\b${c.replace(/[.-]/g, "\\$&")}\\b`, "i").test(address));
  const hasStreet = /^\d+\s+\S/.test(parts[0] ?? "");

  let city = "";
  if (stateAt > 0 && (stateAt > 1 || !hasStreet)) city = parts[stateAt - 1];
  else if (known) city = known;
  else if (parts.length >= 2 && hasStreet && !/^(FL|Florida)\b/i.test(parts[1])) city = parts[1];

  const warnings: string[] = [];
  if (!hasStreet) warnings.push(WARN.street);
  if (!city) warnings.push(WARN.city);
  return { address, city, warnings };
}

/** "Driveway 420 sf" → service "Driveway", size "420 sf". */
export function splitSize(text: string): { service: string; size?: string } {
  const m = text.match(SIZE);
  if (!m) return { service: text.trim() };
  const unit = /^(sq|sf)/i.test(m[2]) ? "sf" : "lnft";
  return { service: text.slice(0, m.index).trim(), size: `${m[1]} ${unit}` };
}

function times(event: CalendarEvent, onDate?: string): { start: string; end: string; allDay?: true } | null {
  if (event.start.dateTime && event.end.dateTime) return { start: event.start.dateTime, end: event.end.dateTime };
  if (event.start.date) {
    // A multi-day all-day event (end date is exclusive) is placed on the day being shown.
    const inRange = onDate && onDate >= event.start.date && (!event.end.date || onDate < event.end.date);
    const day = inRange ? onDate : event.start.date;
    return { start: nyIso(day, ALL_DAY_START), end: nyIso(day, ALL_DAY_END), allDay: true };
  }
  return null;
}

/**
 * @param crew the calendar name, e.g. "Crew 2 · Jorge"
 * @param onDate the board date being built (YYYY-MM-DD); places multi-day all-day events on that day
 */
export function parseEvent(event: CalendarEvent, crew: string, onDate?: string): ParsedEvent {
  if (event.status === "cancelled") return { kind: "skip", reason: "cancelled" };

  const warnings: string[] = [];
  const when = times(event, onDate);
  if (!when) return { kind: "skip", reason: "no start time" };

  const title = (event.summary ?? "").trim();
  if (!title) return { kind: "skip", reason: "no title" };

  const loc = parseLocation(event.location);

  // Estimate visit: "EST – Sorensen – Driveway" or "Estimate – Sorensen – Driveway".
  if (ESTIMATE.test(title)) {
    const [customer = "", ...rest] = scrubPayment(title.replace(ESTIMATE, "")).text.split(SEP);
    return {
      kind: "visit",
      visit: {
        id: event.id,
        start: when.start,
        ...(when.allDay ? { allDay: true } : {}),
        customer: customer.trim() || "Estimate",
        ...(loc.address ? { address: loc.address } : {}),
        city: loc.city,
        service: rest.join(" – ").trim() || "Estimate",
      },
    };
  }

  // Job: "<Customer> – <Service> <size>". Old-style titles carry payment text; scrub it, never read it.
  const scrubbed = scrubPayment(title);
  if (scrubbed.found) warnings.push(WARN.payment);
  const isStop = STOP.test(scrubbed.text);
  const text = scrubbed.text.replace(STOP, "").replace(LEADING_NOTE, "");
  const [head, ...rest] = text.split(SEP);
  let customer = head?.trim() ?? "";
  let service = "";
  let size: string | undefined;
  if (rest.length > 0 && customer) {
    ({ service, size } = splitSize(rest.join(" – ")));
  }
  if (!service && isStop && customer) service = "Stop";
  if (!service) {
    warnings.push(WARN.title);
    if (!customer) customer = scrubbed.text || "Untitled";
    service = "Job";
  }

  const fields = descriptionFields(event.description);
  const deposit = readCheck(fields, "deposit", "Deposit", { OK: "ok", PENDING: "missing" }, warnings);
  const permit = readCheck(fields, "permit", "Permit", { OK: "ok", "N/A": "ok", NA: "ok", PENDING: "missing" }, warnings);
  const material = readCheck(fields, "material", "Material", { OK: "ok", PENDING: "missing" }, warnings);
  const confirm48 = readCheck(fields, "confirm48", "Confirm48", { SENT: "ok", PENDING: "missing" }, warnings);
  if (deposit === "unknown" && !fields.get("deposit")) warnings.push(WARN.deposit);

  let day: Job["day"];
  const dayRaw = fields.get("day");
  if (dayRaw) {
    const m = dayRaw.match(/^(\d+)\s*(?:\/|of)\s*(\d+)$/i);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2])) day = { n: Number(m[1]), of: Number(m[2]) };
    else warnings.push(`Unrecognized Day value "${dayRaw}"`);
  }

  const note = fields.get("note") ? scrubMoney(fields.get("note")!) || undefined : undefined;

  let status: Status = "scheduled";
  if (event.colorId) {
    const s = COLOR_STATUS[event.colorId];
    if (s) status = s;
    else warnings.push(WARN.color);
  }

  // Most important first: the Calendar alert shows them in this order.
  const order = [WARN.deposit, WARN.address, WARN.street, WARN.city];
  const rank = (w: string) => {
    const i = order.indexOf(w as (typeof order)[number]);
    return i === -1 ? order.length : i;
  };
  const parseWarnings = [...warnings, ...loc.warnings].sort((a, b) => rank(a) - rank(b));

  return {
    kind: "job",
    job: {
      id: event.id,
      crew,
      start: when.start,
      end: when.end,
      ...(when.allDay ? { allDay: true } : {}),
      customer,
      address: loc.address,
      city: loc.city,
      service,
      size,
      day,
      status,
      deposit,
      permit,
      material,
      confirm48,
      note,
      parseWarnings,
    },
  };
}
