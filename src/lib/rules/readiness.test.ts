import { describe, expect, it } from "vitest";
import { buildBoard, numberJobs } from "@/lib/board";
import { nextWorkday } from "./readiness";

describe("nextWorkday", () => {
  it("skips the weekend", () => {
    expect(nextWorkday("2026-10-09")).toBe("2026-10-12"); // Fri → Mon
    expect(nextWorkday("2026-10-10")).toBe("2026-10-12"); // Sat → Mon
    expect(nextWorkday("2026-10-12")).toBe("2026-10-13"); // Mon → Tue
  });

  it("includes Saturday when crews work Saturdays", () => {
    expect(nextWorkday("2026-10-09", true)).toBe("2026-10-10");
    expect(nextWorkday("2026-10-10", true)).toBe("2026-10-12");
  });
});

describe("sample board", () => {
  it("matches the prototype's job numbers and order", async () => {
    const board = await buildBoard(new Date("2026-10-09T13:00:00Z"));
    expect(board.jobs.map((j) => `${j.pin} ${j.customer}`)).toEqual([
      "1 Hartley",
      "2 Brennan",
      "5 Marsh",
      "4 Nguyen",
      "3 Okafor",
      "6 Delgado",
      "7 Whitaker",
    ]);
    expect(board.visits.map((v) => v.key)).toEqual(["K1", "K2", "K3", "K4"]);
    expect(board.nextWorkday.date).toBe("2026-10-12");
    expect(board.nextWorkday.rows.map((r) => `${r.customer} · ${r.city} · ${r.crew}`)).toEqual([
      "Pereira · Viera · Crew 2",
      "Ostrowski · Melbourne · Crew 3",
      "Lindqvist · Rockledge · Crew 4",
      "Fairbanks · Palm Bay · Bira",
    ]);
  });

  it("never sends street addresses to the browser", async () => {
    const board = await buildBoard(new Date("2026-10-09T13:00:00Z"));
    expect(JSON.stringify(board)).not.toMatch(/address/i);
    expect(numberJobs([]).length).toBe(0);
  });
});
