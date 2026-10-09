import { describe, expect, it } from "vitest";
import { buildBoard } from "@/lib/board";
import { nyIso } from "@/lib/time";
import type { HourlyRain } from "@/lib/types";
import { buildAlerts, isWeatherSensitive, rainDuring, rainSummary, type AlertInput, type RuleJob } from "./alerts";

const TODAY = "2026-10-09"; // Friday
const NEXT = "2026-10-12"; // Monday

/** A clean job: deposit, permit, material and 48-hour confirmation all OK. */
function job(over: Partial<RuleJob> & { at?: string; until?: string; date?: string } = {}): RuleJob {
  const { at = "07:00", until = "16:00", date = TODAY, ...rest } = over;
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    crew: "Crew 2 · Jorge",
    start: nyIso(date, at),
    end: nyIso(date, until),
    customer: "Hartley",
    city: "Viera",
    service: "Driveway",
    status: "scheduled",
    deposit: "ok",
    permit: "ok",
    material: "ok",
    confirm48: "ok",
    parseWarnings: [],
    ...rest,
  };
}

/** Hourly rain from 7 AM, one value per hour. */
function rain(pops: number[], date = TODAY): HourlyRain[] {
  return pops.map((pop, i) => ({ start: nyIso(date, `${String(7 + i).padStart(2, "0")}:00`), pop }));
}

const DRY = rain(Array(12).fill(10));

function alerts(over: Partial<AlertInput>) {
  return buildAlerts({ today: [], nextWorkday: { date: NEXT, jobs: [] }, hourly: DRY, ...over });
}

describe("no alerts", () => {
  it("a clean day produces none", () => {
    expect(alerts({ today: [job({ pin: 1 })], nextWorkday: { date: NEXT, jobs: [job({ date: NEXT })] } })).toEqual([]);
  });
});

describe("Deposit (D-003)", () => {
  it("flags a job today with a missing deposit as danger", () => {
    const j = job({ pin: 3, customer: "Okafor", deposit: "missing" });
    expect(alerts({ today: [j] })).toEqual([
      {
        severity: "danger",
        label: "Deposit",
        title: "#3 Okafor: no 50% deposit",
        text: "Do not start without written approval from Henrique or Lameck (D-003).",
        jobId: j.id,
      },
    ]);
  });

  it("flags a next-workday job with a missing deposit", () => {
    const j = job({ date: NEXT, customer: "Pereira", deposit: "missing" });
    const [a] = alerts({ nextWorkday: { date: NEXT, jobs: [j] } });
    expect(a).toMatchObject({ severity: "danger", label: "Deposit", title: "Mon · Pereira: no 50% deposit", jobId: j.id });
  });

  it("never treats an unknown deposit as OK, and never as a Deposit alert either", () => {
    const j = job({ pin: 1, deposit: "unknown", parseWarnings: ["Deposit status not found"] });
    const out = alerts({ today: [j] });
    expect(out.map((a) => a.label)).toEqual(["Calendar"]);
  });
});

describe("Stopped", () => {
  it("flags a job today with status issue, using the event note", () => {
    const j = job({ pin: 4, crew: "Felipe", customer: "Nguyen", at: "07:30", status: "issue", note: "Material not delivered" });
    expect(alerts({ today: [j] })).toEqual([
      {
        severity: "danger",
        label: "Stopped",
        title: "#4 Nguyen: material not delivered",
        text: "Felipe waiting since 7:30 AM. Call the supplier.",
        jobId: j.id,
      },
    ]);
  });

  it("asks for a note when the event has none", () => {
    const [a] = alerts({ today: [job({ pin: 2, customer: "Brennan", crew: "Crew 3 · Darwin", status: "issue" })] });
    expect(a.title).toBe("#2 Brennan: stopped");
    expect(a.text).toBe("Darwin waiting since 7:00 AM. Add a Note to the event with the reason.");
  });

  it("ignores issue status on next-workday jobs", () => {
    expect(alerts({ nextWorkday: { date: NEXT, jobs: [job({ date: NEXT, status: "issue" })] } })).toEqual([]);
  });
});

describe("Weather", () => {
  const wet = rain([10, 10, 10, 15, 20, 25, 35, 50, 50, 45, 30, 20]); // 2–5 PM at or above 40%

  it("flags sealing today when rain reaches 40% during the job window", () => {
    const j = job({ pin: 7, crew: "Sealing · Jardel", customer: "Whitaker", service: "Sealing", at: "13:00", until: "17:00" });
    expect(alerts({ today: [j], hourly: wet })).toEqual([
      {
        severity: "warning",
        label: "Weather",
        title: "#7 Whitaker: sealing at 1:00 PM",
        text: "50% rain 2–5 PM. Confirm with Jardel or reschedule.",
        jobId: j.id,
      },
    ]);
  });

  it("flags excavation that overlaps the rain", () => {
    const j = job({ pin: 6, crew: "Excavation · Bira", service: "Patio excavation", at: "12:30", until: "15:00" });
    const [a] = alerts({ today: [j], hourly: wet });
    expect(a).toMatchObject({ label: "Weather", text: "50% rain 2–3 PM. Confirm with Bira or reschedule." });
  });

  it("does not flag excavation that ends before the rain", () => {
    const j = job({ crew: "Excavation · Bira", service: "Patio excavation", at: "12:30", until: "14:00" });
    expect(alerts({ today: [j], hourly: wet })).toEqual([]);
  });

  it("uses 40% as the threshold", () => {
    const j = job({ crew: "Sealing · Jardel", service: "Sealing", at: "07:00", until: "08:00" });
    expect(alerts({ today: [j], hourly: rain([39]) })).toEqual([]);
    expect(alerts({ today: [j], hourly: rain([40]) })).toHaveLength(1);
  });

  it("does not flag paver work in the rain", () => {
    expect(alerts({ today: [job({ service: "Driveway" })], hourly: wet.map((h) => ({ ...h, pop: 90 })) })).toEqual([]);
  });

  it("does not flag completed or postponed jobs", () => {
    const base = { crew: "Sealing · Jardel", service: "Sealing", at: "13:00", until: "17:00" } as const;
    expect(alerts({ today: [job({ ...base, status: "completed" }), job({ ...base, status: "postponed" })], hourly: wet })).toEqual([]);
  });

  it("detects weather-sensitive work by service or crew", () => {
    expect(isWeatherSensitive(job({ service: "Sealing" }))).toBe(true);
    expect(isWeatherSensitive(job({ service: "Driveway excavation" }))).toBe(true);
    expect(isWeatherSensitive(job({ crew: "Excavation · Bira", service: "Grading" }))).toBe(true);
    expect(isWeatherSensitive(job({ service: "Pool deck" }))).toBe(false);
  });

  it("summarizes rain hours across noon", () => {
    const hours = rainDuring(job({ at: "07:00", until: "18:00" }), rain([0, 0, 0, 0, 45, 60, 40]));
    expect(rainSummary(hours)).toBe("60% rain 11 AM–2 PM");
  });
});

describe("all-day events", () => {
  it("says 'today' instead of a made-up time", () => {
    const sealing = job({ pin: 7, crew: "Sealing · Jardel", service: "Sealing", allDay: true, customer: "Whitaker" });
    const stopped = job({ pin: 4, crew: "Felipe", customer: "Nguyen", status: "issue", note: "Material not delivered", allDay: true });
    const out = alerts({ today: [sealing, stopped], hourly: rain([0, 0, 0, 0, 0, 0, 0, 50]) });
    expect(out.find((a) => a.label === "Weather")?.title).toBe("#7 Whitaker: sealing today");
    expect(out.find((a) => a.label === "Stopped")?.text).toBe("Felipe is waiting. Call the supplier.");
  });
});

describe("Customer (D-007)", () => {
  it("flags a next-workday job without the 48-hour confirmation", () => {
    const j = job({ date: NEXT, customer: "Pereira", confirm48: "missing" });
    expect(alerts({ nextWorkday: { date: NEXT, jobs: [j] } })).toEqual([
      {
        severity: "warning",
        label: "Customer",
        title: "Mon · Pereira: 48-hour confirmation not sent",
        text: "Send today with the standard template (D-007).",
        jobId: j.id,
      },
    ]);
  });

  it("does not apply to today's jobs", () => {
    expect(alerts({ today: [job({ pin: 1, confirm48: "missing" })] })).toEqual([]);
  });
});

describe("Permit / Material", () => {
  it("flags a next-workday job with a pending permit", () => {
    const j = job({ date: NEXT, customer: "Ostrowski", permit: "missing" });
    expect(alerts({ nextWorkday: { date: NEXT, jobs: [j] } })).toEqual([
      { severity: "warning", label: "Permit", title: "Mon · Ostrowski: permit pending", text: "No approved permit, no start.", jobId: j.id },
    ]);
  });

  it("flags a next-workday job with material not ordered", () => {
    const j = job({ date: NEXT, customer: "Lindqvist", material: "missing" });
    const [a] = alerts({ nextWorkday: { date: NEXT, jobs: [j] } });
    expect(a).toMatchObject({ severity: "warning", label: "Material", title: "Mon · Lindqvist: material not ordered" });
  });

  it("raises both when both are missing", () => {
    const j = job({ date: NEXT, permit: "missing", material: "missing" });
    expect(alerts({ nextWorkday: { date: NEXT, jobs: [j] } }).map((a) => a.label)).toEqual(["Permit", "Material"]);
  });

  it("does not apply to today's jobs", () => {
    expect(alerts({ today: [job({ pin: 1, permit: "missing", material: "missing" })] })).toEqual([]);
  });
});

describe("Calendar", () => {
  it("flags today's events the parser could not fully read", () => {
    const j = job({ pin: 2, customer: "Brennan", deposit: "unknown", parseWarnings: ["No address", "Deposit status not found"] });
    expect(alerts({ today: [j] })).toEqual([
      {
        severity: "warning",
        label: "Calendar",
        title: "#2 Brennan: no address; deposit status not found",
        text: "Fix the event so the board can read it.",
        jobId: j.id,
      },
    ]);
  });

  it("flags next-workday events too", () => {
    const j = job({ date: NEXT, customer: "Fairbanks", parseWarnings: ["No address"] });
    const [a] = alerts({ nextWorkday: { date: NEXT, jobs: [j] } });
    expect(a).toMatchObject({ label: "Calendar", title: "Mon · Fairbanks: no address" });
  });
});

describe("ordering", () => {
  it("puts Deposit first, then other danger, then warning; each by start time", () => {
    const out = alerts({
      today: [
        job({ pin: 1, customer: "A", at: "13:00", crew: "Sealing · Jardel", service: "Sealing", until: "17:00" }),
        job({ pin: 2, customer: "B", at: "08:00", deposit: "missing" }),
        job({ pin: 3, customer: "C", at: "07:30", status: "issue", note: "Rain" }),
      ],
      nextWorkday: { date: NEXT, jobs: [job({ date: NEXT, customer: "D", at: "06:00", deposit: "missing" })] },
      hourly: rain([0, 0, 0, 0, 0, 0, 50, 50, 50, 50]),
    });
    expect(out.map((a) => `${a.severity}:${a.title.split(":")[0]}`)).toEqual([
      "danger:#2 B",
      "danger:Mon · D",
      "danger:#3 C",
      "warning:#1 A",
    ]);
  });

  it("keeps rule order for alerts at the same time", () => {
    const j = job({ date: NEXT, confirm48: "missing", permit: "missing" });
    expect(alerts({ nextWorkday: { date: NEXT, jobs: [j] } }).map((a) => a.label)).toEqual(["Customer", "Permit"]);
  });
});

describe("sample board", () => {
  it("raises the prototype's five alerts", async () => {
    const board = await buildBoard(new Date("2026-10-09T13:00:00Z"));
    expect(board.alerts.map((a) => [a.label, a.title])).toEqual([
      ["Deposit", "#3 Okafor: no 50% deposit"],
      ["Stopped", "#4 Nguyen: material not delivered"],
      ["Weather", "#7 Whitaker: sealing at 1:00 PM"],
      ["Customer", "Mon · Pereira: 48-hour confirmation not sent"],
      ["Permit", "Mon · Ostrowski: permit pending"],
    ]);
  });
});
