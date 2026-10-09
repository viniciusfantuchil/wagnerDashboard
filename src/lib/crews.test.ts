import { describe, expect, it } from "vitest";
import { crewColor, crewShort, isSealing } from "./crews";

describe("crewColor", () => {
  it.each([
    ["Crew 1 · Fernando", "#f4511e"],
    ["Crew 2 · Jorge", "#8e24aa"],
    ["Crew 3 · Darwin", "#33b679"],
    ["Crew 4 · Jhonny", "#7cb342"],
    ["Felipe", "#039be5"],
    ["Excavation · Bira", "#d50000"],
    ["Sealing · Jardel", "#3f51b5"],
  ])("%s → %s (its Google Calendar color)", (crew, color) => {
    expect(crewColor(crew)).toBe(color);
  });

  it("has no color for an unknown calendar", () => {
    expect(crewColor("Office")).toBeUndefined();
    expect(crewColor("Crew 12 · New")).toBeUndefined();
  });
});

describe("crewShort", () => {
  it("keeps crew numbers and uses the lead's name otherwise", () => {
    expect(["Crew 2 · Jorge", "Excavation · Bira", "Felipe"].map(crewShort)).toEqual(["Crew 2", "Bira", "Felipe"]);
  });
});

describe("isSealing", () => {
  it("picks the sealing calendar only", () => {
    expect(["Sealing · Jardel", "Sealing", "Crew 2 · Jorge", "Excavation · Bira", "Felipe"].map(isSealing)).toEqual([true, true, false, false, false]);
  });
});
