import { describe, expect, it } from "vitest";
import { applyChanges, validateChanges } from "./changes";
import type { ControlJob } from "./jobs";
import { attentionCounts, attentionMatch, canStop, nextStep, readinessChips, revertOf, statusTone } from "./quick";

const job = (id: string, values: ControlJob["values"]): ControlJob => ({
  id,
  crew: "Crew 2 · Jorge",
  crewShort: "Crew 2",
  customer: id,
  city: "Viera",
  service: "Driveway",
  start: "2026-10-09T07:00:00-04:00",
  values: { Status: "Scheduled", Deposit: "OK", Permit: "APPROVED", Material: "ORDERED", Confirm48: "SENT", Note: "", ...values },
  warnings: [],
});

describe("next step button", () => {
  it.each([
    ["Scheduled", "Start", "In progress"],
    [undefined, "Start", "In progress"],
    ["In progress", "Done", "Done"],
    ["Issue", "Resume", "In progress"],
  ])("%s → %s", (status, label, to) => {
    expect(nextStep(status)).toEqual({ label, status: to });
  });

  it("offers nothing for done or postponed jobs, and Issue only while scheduled or under way", () => {
    expect(nextStep("Done")).toBeNull();
    expect(nextStep("Postponed")).toBeNull();
    expect([undefined, "Scheduled", "In progress", "Issue", "Done", "Postponed"].map(canStop)).toEqual([true, true, true, false, false, false]);
  });

  it("maps status to the board's status colors", () => {
    expect(["Scheduled", "In progress", "Done", "Issue", "Postponed"].map(statusTone)).toEqual(["scheduled", "progress", "done", "issue", "postponed"]);
  });
});

describe("readiness chips", () => {
  it("always say the state in words, and never show an unknown deposit as OK (D-003)", () => {
    const chips = readinessChips(job("a", { Deposit: undefined, Permit: "N/A", Material: "NOT ORDERED", Confirm48: "SENT" }));
    expect(chips.map((c) => [c.label, c.tone])).toEqual([
      ["Deposit ?", "warn"],
      ["Permit N/A", "muted"],
      ["Material not ordered", "warn"],
      ["48h ✓", "ok"],
    ]);
    expect(readinessChips(job("b", { Deposit: "PENDING" }))[0]).toMatchObject({ label: "Deposit pending", tone: "bad" });
  });

  it("tells a 50% deposit from the final payment, a requested permit from an approved one, and shows where material goes", () => {
    const labels = (values: ControlJob["values"]) => readinessChips(job("c", values)).map((c) => c.label);
    expect(labels({ Deposit: "OK", Permit: "REQUESTED", Material: "ORDERED", Delivery: "SHOWROOM" })).toEqual([
      "Deposit 50% ✓",
      "Permit requested",
      "Material ordered",
      "To showroom",
      "48h ✓",
    ]);
    expect(labels({ Deposit: "FINAL", Permit: "APPROVED", Delivery: "JOB SITE", Confirm48: "PENDING" })).toEqual([
      "Final payment ✓",
      "Permit ✓",
      "Material ordered",
      "To job site",
      "48h pending",
    ]);
  });
});

describe("needs attention", () => {
  const today = {
    date: "2026-10-09",
    jobs: [
      job("stopped", { Status: "Issue" }),
      job("nodeposit", { Deposit: undefined }),
      job("pending", { Deposit: "PENDING", Confirm48: "PENDING" }), // today's confirmation is not an alert
      job("done", { Status: "Done", Deposit: "PENDING" }),
    ],
  };
  const next = {
    date: "2026-10-12",
    jobs: [
      job("unconfirmed", { Confirm48: "PENDING", Material: undefined }),
      job("permit", { Permit: "REQUESTED", Deposit: "FINAL" }),
      job("postponed", { Status: "Postponed", Confirm48: "PENDING" }),
    ],
  };

  it("counts today's and the next workday's items like the TV alerts", () => {
    expect(attentionCounts([today, next], true).map((a) => a.label)).toEqual([
      "1 stopped",
      "2 deposit pending",
      "1 not confirmed (48 h)",
      "1 material not ordered",
      "1 permit not approved",
    ]);
  });

  it("shows crew leads only stopped jobs", () => {
    expect(attentionCounts([today, next], false).map((a) => a.key)).toEqual(["stopped"]);
  });

  it("filters the cards of one item", () => {
    expect(today.jobs.filter((j) => attentionMatch("deposit", j, false)).map((j) => j.id)).toEqual(["nodeposit", "pending"]);
    expect(next.jobs.filter((j) => attentionMatch("confirm48", j, true)).map((j) => j.id)).toEqual(["unconfirmed"]);
  });

  it("is empty when everything is set", () => {
    expect(attentionCounts([{ date: "2026-10-09", jobs: [job("ok", {})] }], true)).toEqual([]);
  });
});

describe("undo", () => {
  it("puts back the previous values; a check that had no value can't be un-written", () => {
    const before = job("a", { Status: "Scheduled", Deposit: undefined, Note: "" });
    expect(revertOf(before, { Status: "Issue", Note: "Rain" })).toEqual({ Status: "Scheduled", Note: "" });
    expect(revertOf(before, { Deposit: "OK" })).toEqual({});
    expect(revertOf({ ...before, values: { ...before.values, Note: undefined } }, { Note: "x" })).toEqual({ Note: "" });
  });
});

describe("new readiness values from the screen", () => {
  const office = { username: "diandra", name: "Diandra", office: true };
  const lead = { username: "jorge", name: "Jorge", office: false, crew: "Crew 2" };

  it("accepts final payment, permit requested / approved, material ordered and delivery for the office", () => {
    expect(validateChanges({ Deposit: "FINAL", Permit: "REQUESTED", Material: "NOT ORDERED", Delivery: "SHOWROOM" }, office)).toEqual({
      Deposit: "FINAL",
      Permit: "REQUESTED",
      Material: "NOT ORDERED",
      Delivery: "SHOWROOM",
    });
    expect(() => validateChanges({ Permit: "OK" }, office)).toThrow(/Permit must be one of: REQUESTED, APPROVED, N\/A/);
  });

  it("keeps delivery and payment with the office (D-003)", () => {
    expect(() => validateChanges({ Delivery: "JOB SITE" }, lead)).toThrow(/Only the office/);
    expect(() => validateChanges({ Deposit: "FINAL" }, lead)).toThrow(/Only the office/);
  });

  it("writes the lines the parser reads back", () => {
    const desc = applyChanges("Deposit: OK\nPermit: PENDING", { Deposit: "FINAL", Permit: "APPROVED", Delivery: "JOB SITE" }, "Diandra · Oct 9, 2:15 PM");
    expect(desc).toBe("Deposit: FINAL\nPermit: APPROVED\nDelivery: JOB SITE\nUpdated: Diandra · Oct 9, 2:15 PM");
  });
});
