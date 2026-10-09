import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { numberJobs } from "@/lib/board";
import { nyIso } from "@/lib/time";
import type { Job } from "@/lib/types";
import { BoardMap } from "./BoardMap";

const stop = (id: string, routeOrder: number | undefined, lat: number, crew = "Sealing · Jardel"): Job => ({
  id,
  crew,
  start: nyIso("2026-10-09", "07:00"),
  end: nyIso("2026-10-09", "16:00"),
  allDay: true,
  customer: id,
  address: "",
  city: "Melbourne",
  lat,
  lon: -80.62,
  service: "Sealing",
  ...(routeOrder !== undefined ? { routeOrder } : {}),
  status: "scheduled",
  deposit: "ok",
  permit: "ok",
  material: "ok",
  confirm48: "ok",
  parseWarnings: [],
});

describe("route order on the board", () => {
  const jobs = numberJobs([stop("C", 3, 28.1), stop("A", 1, 28.3), stop("Other", undefined, 28.2, "Crew 2 · Jorge"), stop("B", 2, 28.2)]);

  it("numbers a crew's pins in route order", () => {
    expect(jobs.filter((j) => j.crew.startsWith("Sealing")).map((j) => `${j.pin} ${j.customer}`)).toEqual(["2 A", "3 B", "4 C"]);
  });

  it("draws one dashed line through the stops, in route order, in the crew color", () => {
    const svg = renderToStaticMarkup(<BoardMap jobs={jobs} visits={[]} />);
    const lines = svg.match(/<polyline[^>]*>/g) ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]!).toContain("stroke:#3f51b5");
    const ys = lines[0]!.match(/points="([^"]+)"/)![1].split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys[0]).toBeLessThan(ys[1]); // A (north) → B → C (south)
    expect(ys[1]).toBeLessThan(ys[2]);
  });
});
