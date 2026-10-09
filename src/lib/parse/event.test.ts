import { describe, expect, it } from "vitest";
import { buildAlerts } from "@/lib/rules/alerts";
import type { Job, Visit } from "@/lib/types";
import { WARN, descriptionFields, parseEvent, parseLocation, splitSize, type CalendarEvent } from "./event";

const CREW = "Crew 2 · Jorge";

const FULL_DESCRIPTION = ["Deposit: OK", "Permit: N/A", "Material: OK", "Confirm48: SENT", "Day: 2/2", "Note: Gate code 1234"].join("\n");

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt1",
    summary: "Hartley – Driveway 420 sf",
    location: "1234 Example Dr, Viera, FL 32940",
    description: FULL_DESCRIPTION,
    start: { dateTime: "2026-10-09T07:00:00-04:00" },
    end: { dateTime: "2026-10-09T16:00:00-04:00" },
    ...over,
  };
}

function job(over: Partial<CalendarEvent> = {}, crew = CREW): Job {
  const r = parseEvent(event(over), crew);
  if (r.kind !== "job") throw new Error(`expected a job, got ${r.kind}`);
  return r.job;
}

function visit(over: Partial<CalendarEvent> = {}): Visit {
  const r = parseEvent(event(over), "Excavation · Bira");
  if (r.kind !== "visit") throw new Error(`expected a visit, got ${r.kind}`);
  return r.visit;
}

describe("new-style events", () => {
  it("reads a fully filled-in event", () => {
    expect(job()).toEqual({
      id: "evt1",
      crew: CREW,
      start: "2026-10-09T07:00:00-04:00",
      end: "2026-10-09T16:00:00-04:00",
      customer: "Hartley",
      address: "1234 Example Dr, Viera, FL 32940",
      city: "Viera",
      service: "Driveway",
      size: "420 sf",
      day: { n: 2, of: 2 },
      status: "scheduled",
      deposit: "ok",
      permit: "ok",
      material: "ok",
      confirm48: "ok",
      note: "Gate code 1234",
      parseWarnings: [],
    });
  });

  it.each([
    ["Hartley – Driveway 420 sf", "Hartley", "Driveway", "420 sf"],
    ["Hartley - Driveway 420 sf", "Hartley", "Driveway", "420 sf"],
    ["Hartley — Driveway 420sf", "Hartley", "Driveway", "420 sf"],
    ["Brennan – Pool deck 1,380 sq ft", "Brennan", "Pool deck", "1,380 sf"],
    ["Nguyen – Wall block 65 lnft", "Nguyen", "Wall block", "65 lnft"],
    ["Nguyen – Wall block 65 LF", "Nguyen", "Wall block", "65 lnft"],
    ["Whitaker – Sealing", "Whitaker", "Sealing", undefined],
    ["Van der Berg – Patio + walk 300 sf", "Van der Berg", "Patio + walk", "300 sf"],
  ])("splits %j", (summary, customer, service, size) => {
    const j = job({ summary });
    expect([j.customer, j.service, j.size]).toEqual([customer, service, size]);
    expect(j.parseWarnings).toEqual([]);
  });

  it("keeps hyphens inside names", () => {
    expect(job({ summary: "Smith-Jones – Patio 200 sf" }).customer).toBe("Smith-Jones");
  });

  it("reads description keys case-insensitively", () => {
    const j = job({ description: "deposit: ok\nPERMIT: pending\nmaterial: Pending\nconfirm48: pending\nday: 1 of 3" });
    expect([j.deposit, j.permit, j.material, j.confirm48, j.day]).toEqual(["ok", "missing", "missing", "missing", { n: 1, of: 3 }]);
  });

  it("reads HTML descriptions from the Google Calendar editor", () => {
    const j = job({ description: "<b>Deposit:</b> OK<br>Permit: PENDING<br/><span>Note: Call&nbsp;before 8</span>" });
    expect([j.deposit, j.permit, j.note]).toEqual(["ok", "missing", "Call before 8"]);
  });

  it("treats missing keys as unknown", () => {
    const j = job({ description: "Deposit: OK" });
    expect([j.permit, j.material, j.confirm48, j.day, j.note]).toEqual(["unknown", "unknown", "unknown", undefined, undefined]);
    expect(j.parseWarnings).toEqual([]);
  });

  it("warns on values it does not recognize", () => {
    const j = job({ description: "Deposit: OK\nPermit: maybe\nDay: 3/2" });
    expect(j.permit).toBe("unknown");
    expect(j.day).toBeUndefined();
    expect(j.parseWarnings).toEqual(['Unrecognized Permit value "maybe"', 'Unrecognized Day value "3/2"']);
  });
});

describe("deposit (D-003)", () => {
  it("is missing when PENDING", () => {
    expect(job({ description: "Deposit: PENDING" }).deposit).toBe("missing");
  });

  it("is unknown, with a warning, when the key is absent", () => {
    const j = job({ description: "Permit: OK" });
    expect(j.deposit).toBe("unknown");
    expect(j.parseWarnings).toEqual([WARN.deposit]);
  });

  it.each(["Paid", "yes", "50%", "received", "ok?"])("is never guessed as OK from %j", (value) => {
    const j = job({ description: `Deposit: ${value}` });
    expect(j.deposit).toBe("unknown");
    expect(j.parseWarnings).toEqual([`Unrecognized Deposit value "${value}"`]);
  });

  it("is never read from the title", () => {
    const j = job({ summary: "Hartley – Driveway 420 sf DEPOSIT PAID", description: "" });
    expect(j.deposit).toBe("unknown");
  });
});

describe("old-style titles", () => {
  it("shows an event with payment text in the title, with unknown fields and warnings", () => {
    const j = job({ summary: "Okafor patio 50% paid $4,250", description: "" });
    expect(j.customer).toBe("Okafor patio");
    expect(j.service).toBe("Job");
    expect([j.deposit, j.permit, j.material, j.confirm48]).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(j.parseWarnings).toEqual([WARN.deposit, WARN.payment, WARN.title]);
  });

  it("strips payment text from an otherwise new-style title", () => {
    const j = job({ summary: "Brennan - Pool deck 380 sf - DEP PAID $2,000" });
    expect([j.customer, j.service, j.size]).toEqual(["Brennan", "Pool deck", "380 sf"]);
    expect(j.parseWarnings).toEqual([WARN.payment]);
  });

  it("never lets a dollar amount reach the screen", () => {
    const j = job({ summary: "Marsh $12.5k balance due – Driveway", description: "Deposit: OK\nNote: collect $3,100 at the end" });
    const onScreen = JSON.stringify([j.customer, j.service, j.size, j.note, j.parseWarnings]);
    expect(onScreen).not.toMatch(/\$|\d,\d{3}|12\.5/);
    expect(j.customer).toBe("Marsh");
    expect(j.note).toBe("collect at the end");
  });

  it("keeps a bare customer name", () => {
    const j = job({ summary: "Lindqvist", description: "Deposit: OK" });
    expect([j.customer, j.service, j.parseWarnings]).toEqual(["Lindqvist", "Job", [WARN.title]]);
  });

  it("raises a Calendar alert, not a Deposit alert", () => {
    const j = job({ summary: "Okafor patio pd", description: "" });
    const alerts = buildAlerts({ today: [{ ...j, pin: 3 }], nextWorkday: { date: "2026-10-12", jobs: [] }, hourly: [] });
    expect(alerts.map((a) => [a.label, a.title])).toEqual([
      ["Calendar", "#3 Okafor patio: deposit status not found; payment text in title; title not in 'Customer – Service size' format"],
    ]);
  });
});

describe("titles seen on the Wagner calendars", () => {
  it.each([
    ["Stop @ Barry Schiedel", "Barry Schiedel", "Stop", undefined],
    ["Stop @ Halfhide – Repair", "Halfhide", "Repair", undefined],
    ["(Morning) Pam Gonzalez – 1038sf Sealer", "Pam Gonzalez", "1038sf Sealer", undefined],
    ["Robert Garrett – 645sf Driveway Ext + 310sf Repair", "Robert Garrett", "645sf Driveway Ext + 310sf Repair", undefined],
    ["Ashley Spring – Driveway 1626 sf", "Ashley Spring", "Driveway", "1626 sf"],
  ])("reads %j", (summary, customer, service, size) => {
    const j = job({ summary });
    expect([j.customer, j.service, j.size]).toEqual([customer, service, size]);
    expect(j.parseWarnings).toEqual([]);
  });

  it("reads 'Estimate' titles as estimate visits", () => {
    const r = parseEvent(event({ summary: "Estimate – Kathy Metz – Driveway" }), "Excavation · Bira");
    expect(r).toMatchObject({ kind: "visit", visit: { customer: "Kathy Metz", service: "Driveway" } });
    const bare = parseEvent(event({ summary: "Estimate" }), "Excavation · Bira");
    expect(bare).toMatchObject({ kind: "visit", visit: { customer: "Estimate", service: "Estimate" } });
  });

  it("marks all-day estimate visits", () => {
    const r = parseEvent(event({ summary: "EST – Pike", start: { date: "2026-10-09" }, end: { date: "2026-10-10" } }), "Excavation · Bira");
    expect(r.kind === "visit" && r.visit.allDay).toBe(true);
  });
});

describe("route order (the sequence the crew should follow)", () => {
  const SEAL = "Sealing · Jardel";
  it.each([
    ["Linda Green – 1", "Linda Green", "Sealing", 1],
    ["Mark & Anne Persichetti - 2", "Mark & Anne Persichetti", "Sealing", 2],
    ["Stop @ Shafer – 4", "Shafer", "Stop", 4],
    ["Stop @ Merker 3", "Merker", "Stop", 3],
    ["Pam Gonzalez – 1038sf Sealer – 5", "Pam Gonzalez", "1038sf Sealer", 5],
  ])("reads %j", (summary, customer, service, routeOrder) => {
    const j = job({ summary }, SEAL);
    expect([j.customer, j.service, j.routeOrder]).toEqual([customer, service, routeOrder]);
    expect(j.parseWarnings).toEqual([]);
  });

  it("uses the crew's work as the service when the title has only a name and a number", () => {
    expect(job({ summary: "Persichetti – 2" }, "Excavation · Bira").service).toBe("Excavation");
    expect(job({ summary: "Persichetti – 2" }, CREW).service).toBe("Stop");
  });

  it("does not read sizes or house numbers as a route order", () => {
    expect(job({ summary: "Hartley – Driveway 420 sf" }).routeOrder).toBeUndefined();
    expect(job({ summary: "Hartley – 420 sf" }).routeOrder).toBeUndefined();
    expect(job({ summary: "Merker 3" }).routeOrder).toBeUndefined(); // only on "Stop @" titles
  });
});

describe("estimate visits", () => {
  it.each([
    ["EST – Sorensen – Driveway", "Sorensen", "Driveway"],
    ["EST - Alvarez - Pool deck", "Alvarez", "Pool deck"],
    ["est: Pike – Patio + walk", "Pike", "Patio + walk"],
    ["EST – Romano", "Romano", "Estimate"],
  ])("reads %j", (summary, customer, service) => {
    const v = visit({ summary, location: "55 Ocean Blvd, Cocoa Beach, FL 32931", start: { dateTime: "2026-10-09T16:00:00-04:00" } });
    expect(v).toEqual({ id: "evt1", start: "2026-10-09T16:00:00-04:00", customer, address: "55 Ocean Blvd, Cocoa Beach, FL 32931", city: "Cocoa Beach", service });
  });

  it("does not treat a customer named Esteban as an estimate", () => {
    expect(parseEvent(event({ summary: "Esteban – Patio 200 sf" }), CREW).kind).toBe("job");
  });
});

describe("status from the description", () => {
  it.each([
    [undefined, "scheduled"],
    ["Scheduled", "scheduled"],
    ["In progress", "in_progress"],
    ["IN-PROGRESS", "in_progress"],
    ["started", "in_progress"],
    ["Issue", "issue"],
    ["Stopped", "issue"],
    ["Done", "completed"],
    ["Completed", "completed"],
    ["Postponed", "postponed"],
  ] as const)("Status: %j → %s", (value, status) => {
    const description = value === undefined ? FULL_DESCRIPTION : `${FULL_DESCRIPTION}\nStatus: ${value}`;
    expect(job({ description }).status).toBe(status);
  });

  it("treats an unknown value as scheduled, with a warning", () => {
    const j = job({ description: `${FULL_DESCRIPTION}\nStatus: maybe tomorrow` });
    expect(j.status).toBe("scheduled");
    expect(j.parseWarnings).toEqual(['Unrecognized Status value "maybe tomorrow"']);
  });

  it.each(["11", "7", "5", "8", "3"])("ignores the event color (colorId %s identifies the crew)", (colorId) => {
    const j = job({ colorId });
    expect(j.status).toBe("scheduled");
    expect(j.parseWarnings).toEqual([]);
  });
});

describe("location", () => {
  it.each([
    ["1234 Example Dr, Viera, FL 32940", "Viera", []],
    ["1234 Example Dr, Merritt Island, FL 32953, USA", "Merritt Island", []],
    ["1234 Example Dr, West Melbourne FL 32904", "West Melbourne", []],
    ["1234 Example Dr, Melbourne", "Melbourne", []],
    ["1234 Example Dr, FL 32940", "", [WARN.city]],
    ["Satellite Beach", "Satellite Beach", [WARN.street]],
    ["Viera, FL", "Viera", [WARN.street]],
  ])("%j → %j", (location, city, warnings) => {
    expect(parseLocation(location)).toEqual({ address: location, city, warnings });
  });

  it("warns when there is no location", () => {
    const j = job({ location: undefined });
    expect([j.address, j.city, j.parseWarnings]).toEqual(["", "", [WARN.address]]);
  });

  it("lists the deposit warning before address warnings", () => {
    expect(job({ location: "", description: "" }).parseWarnings).toEqual([WARN.deposit, WARN.address]);
  });
});

describe("times", () => {
  it("marks all-day events and places them in the workday, without a warning", () => {
    const j = job({ start: { date: "2026-10-09" }, end: { date: "2026-10-10" } });
    expect([j.start, j.end, j.allDay]).toEqual(["2026-10-09T07:00:00-04:00", "2026-10-09T16:00:00-04:00", true]);
    expect(j.parseWarnings).toEqual([]);
  });

  it("does not mark timed events as all-day", () => {
    expect(job().allDay).toBeUndefined();
  });

  it("places a multi-day all-day event on the day being shown", () => {
    const r = parseEvent(event({ start: { date: "2026-10-08" }, end: { date: "2026-10-10" } }), CREW, "2026-10-09");
    expect(r.kind === "job" && r.job.start).toBe("2026-10-09T07:00:00-04:00");
  });

  it("uses the EST offset in winter", () => {
    const j = job({ start: { date: "2026-12-14" }, end: { date: "2026-12-15" } });
    expect(j.start).toBe("2026-12-14T07:00:00-05:00");
  });
});

describe("skipped events", () => {
  it("skips cancelled events", () => {
    expect(parseEvent(event({ status: "cancelled" }), CREW)).toEqual({ kind: "skip", reason: "cancelled" });
  });

  it("skips events without a title", () => {
    expect(parseEvent(event({ summary: "  " }), CREW)).toEqual({ kind: "skip", reason: "no title" });
  });
});

describe("helpers", () => {
  it("keeps the first occurrence of a key", () => {
    expect(descriptionFields("Deposit: PENDING\nDeposit: OK").get("deposit")).toBe("PENDING");
  });

  it("splits sizes only at the end", () => {
    expect(splitSize("Driveway 420 sf")).toEqual({ service: "Driveway", size: "420 sf" });
    expect(splitSize("2 car driveway")).toEqual({ service: "2 car driveway" });
  });
});
