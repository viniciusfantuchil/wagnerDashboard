// Alert rules from docs/SPEC-phase-1.md §7.

import { crewLead } from "@/lib/crews";
import { clock12, hourRange, minuteOfDay, weekdayShort } from "@/lib/time";
import type { Alert, HourlyRain, Job } from "@/lib/types";

/** Rain probability (%) at which weather-sensitive work is flagged. */
export const RAIN_ALERT_PCT = 40;

/** Alerts shown on screen; the rest collapse into "+N more". */
export const MAX_ALERTS = 6;

export type RuleJob = Omit<Job, "address"> & { pin?: number };

export interface AlertInput {
  today: RuleJob[];
  nextWorkday: { date: string; jobs: RuleJob[] };
  hourly: HourlyRain[];
}

interface Ranked {
  alert: Alert;
  start: string;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Sealing and excavation cannot run in the rain. */
export function isWeatherSensitive(job: RuleJob): boolean {
  return /seal|excavat/i.test(job.service) || /^(sealing|excavation)\b/i.test(job.crew);
}

/** Hourly entries that overlap the job window and reach the alert threshold. */
export function rainDuring(job: RuleJob, hourly: HourlyRain[]): HourlyRain[] {
  const from = minuteOfDay(job.start);
  const to = minuteOfDay(job.end);
  return hourly.filter((h) => {
    const m = minuteOfDay(h.start);
    return m < to && m + 60 > from && h.pop >= RAIN_ALERT_PCT;
  });
}

/** "50% rain 2–5 PM" for hours at or above the threshold, or null when there are none. */
export function rainSummary(hours: HourlyRain[]): string | null {
  if (hours.length === 0) return null;
  const max = Math.max(...hours.map((h) => h.pop));
  const first = Math.floor(minuteOfDay(hours[0].start) / 60);
  const last = Math.floor(minuteOfDay(hours[hours.length - 1].start) / 60);
  return `${max}% rain ${hourRange(first, last + 1)}`;
}

/** Next-step hints for stopped jobs, matched against the event note. */
const STOPPED_HINTS: [RegExp, string][] = [[/material/i, "Call the supplier."]];

export function buildAlerts({ today, nextWorkday, hourly }: AlertInput): Alert[] {
  const out: Ranked[] = [];
  const add = (job: RuleJob, alert: Omit<Alert, "jobId">) => out.push({ alert: { ...alert, jobId: job.id }, start: job.start });
  const todayName = (j: RuleJob) => (j.pin ? `#${j.pin} ${j.customer}` : j.customer);
  const nextName = (j: RuleJob) => `${weekdayShort(nextWorkday.date)} · ${j.customer}`;
  const both = [
    ...today.map((job) => ({ job, name: todayName(job) })),
    ...nextWorkday.jobs.map((job) => ({ job, name: nextName(job) })),
  ];

  // Deposit (D-003): today or next workday. An unknown deposit is never treated as OK; it raises a Calendar alert below.
  for (const { job, name } of both) {
    if (job.deposit === "missing") {
      add(job, {
        severity: "danger",
        label: "Deposit",
        title: `${name}: no 50% deposit`,
        text: "Do not start without written approval from Henrique or Lameck (D-003).",
      });
    }
  }

  // Stopped: today's jobs with status "issue", explained by the event Note.
  for (const job of today) {
    if (job.status !== "issue") continue;
    const hint = STOPPED_HINTS.find(([re]) => job.note && re.test(job.note))?.[1];
    add(job, {
      severity: "danger",
      label: "Stopped",
      title: `${todayName(job)}: ${job.note ? lowerFirst(job.note) : "stopped"}`,
      text: [
        `${crewLead(job.crew)} waiting since ${clock12(job.start)}.`,
        job.note ? hint : "Add a Note to the event with the reason.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  // Weather: sealing or excavation today with rain at or above the threshold during the job window.
  for (const job of today) {
    if (!isWeatherSensitive(job) || job.status === "completed" || job.status === "postponed") continue;
    const rain = rainSummary(rainDuring(job, hourly));
    if (!rain) continue;
    add(job, {
      severity: "warning",
      label: "Weather",
      title: `${todayName(job)}: ${lowerFirst(job.service)} at ${clock12(job.start)}`,
      text: `${rain}. Confirm with ${crewLead(job.crew)} or reschedule.`,
    });
  }

  // Customer (D-007): 48-hour confirmation for the next workday.
  for (const job of nextWorkday.jobs) {
    if (job.confirm48 === "missing") {
      add(job, {
        severity: "warning",
        label: "Customer",
        title: `${nextName(job)}: 48-hour confirmation not sent`,
        text: "Send today with the standard template (D-007).",
      });
    }
  }

  // Permit / Material for the next workday.
  for (const job of nextWorkday.jobs) {
    if (job.permit === "missing") {
      add(job, { severity: "warning", label: "Permit", title: `${nextName(job)}: permit pending`, text: "No approved permit, no start." });
    }
    if (job.material === "missing") {
      add(job, {
        severity: "warning",
        label: "Material",
        title: `${nextName(job)}: material not confirmed`,
        text: "Confirm the delivery before the crew goes out.",
      });
    }
  }

  // Calendar: events the parser could not fully read.
  for (const { job, name } of both) {
    if (job.parseWarnings.length > 0) {
      add(job, {
        severity: "warning",
        label: "Calendar",
        title: `${name}: ${job.parseWarnings.map(lowerFirst).join("; ")}`,
        text: "Fix the event so the board can read it.",
      });
    }
  }

  return rankAlerts(out);
}

/** Deposit (D-003) first, then other danger, then warning; within each group by start time. Ties keep rule order. */
function rankAlerts(items: Ranked[]): Alert[] {
  const group = (a: Alert) => (a.label === "Deposit" ? 0 : a.severity === "danger" ? 1 : 2);
  return items
    .map((item, i) => ({ ...item, i }))
    .sort((a, b) => group(a.alert) - group(b.alert) || Date.parse(a.start) - Date.parse(b.start) || a.i - b.i)
    .map((r) => r.alert);
}
