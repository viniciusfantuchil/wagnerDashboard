import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as SEARCH } from "@/app/api/control/search/route";
import type { ScheduleSource } from "@/lib/sources";
import { nyIso } from "@/lib/time";
import type { Job } from "@/lib/types";
import { hashPassword } from "./password";
import { fold, matchesText, needsIt, parseSearch, SearchError, searchJobs } from "./search";
import { toControlJob } from "./jobs";
import { MemoryUserStore, setUserStoreForTests } from "./store";
import { CONTROL_COOKIE, sessionCookie, type ControlUser } from "./users";

const OFFICE: ControlUser = { username: "diandra", name: "Diandra", office: true };
const JORGE: ControlUser = { username: "jorge", name: "Jorge", office: false, crew: "Crew 2" };
const NOW = new Date("2026-10-09T13:00:00Z"); // Fri Oct 9, 9 AM in Rockledge

function job(id: string, date: string, over: Partial<Job> = {}): Job {
  return {
    id,
    crew: "Crew 2 · Jorge",
    start: nyIso(date, "07:00"),
    end: nyIso(date, "16:00"),
    customer: "Hartley",
    address: "1234 Example Dr, Viera, FL 32940",
    city: "Viera",
    service: "Driveway",
    size: "420 sf",
    status: "scheduled",
    deposit: "ok",
    permit: "ok",
    material: "ok",
    confirm48: "ok",
    parseWarnings: [],
    ...over,
  };
}

const JOBS: Job[] = [
  job("past", "2026-09-20", { customer: "José Álvarez", city: "Melbourne", status: "completed" }),
  job("soon", "2026-10-12", { customer: "Hartley", note: "Gate code at side door" }),
  job("later", "2026-10-20", { customer: "Nguyen", service: "Wall block", crew: "Crew 3 · Darwin", deposit: "missing", status: "issue" }),
  job("first", "2026-10-12", { customer: "Hart Pools", crew: "Crew 1 · Fernando", deposit: "unknown" }),
  job("far", "2027-06-01", { customer: "Hartley" }), // beyond the 180-day window
];

function schedule(jobs = JOBS): ScheduleSource & { ranges: string[] } {
  const ranges: string[] = [];
  return {
    ranges,
    label: "test",
    sample: false,
    getDay: async () => ({ jobs: [], visits: [] }),
    getJobs: async (from, to) => {
      ranges.push(`${from}..${to}`);
      return jobs;
    },
    getBookedThrough: async () => null,
  };
}

const q = (params: Record<string, string>, user = OFFICE) => parseSearch(new URLSearchParams(params), user);

describe("job search", () => {
  it("finds every word in customer, city, service, crew, note or status, ignoring case and accents", () => {
    const hartley = toControlJob(JOBS[1]);
    expect(matchesText(hartley, "hart viera")).toBe(true);
    expect(matchesText(hartley, "gate")).toBe(true);
    expect(matchesText(hartley, "crew 2 driveway")).toBe(true);
    expect(matchesText(hartley, "hart melbourne")).toBe(false);
    expect(matchesText(toControlJob(JOBS[0]), "jose alvarez")).toBe(true);
    expect(fold("ÁLVAREZ")).toBe("alvarez");
  });

  it("never searches by street address", () => {
    expect(matchesText(toControlJob(JOBS[1]), "example dr")).toBe(false);
  });

  it("lists upcoming matches soonest first, by crew, and only within the window", async () => {
    const src = schedule();
    const out = await searchJobs(OFFICE, src, q({ q: "hart" }), NOW);
    expect(out.results.map((r) => [r.date, r.job.id])).toEqual([
      ["2026-10-12", "first"],
      ["2026-10-12", "soon"],
    ]);
    expect(src.ranges).toEqual(["2026-10-09..2027-04-07"]);
    expect(JSON.stringify(out)).not.toContain("Example Dr");
  });

  it("searches the past most recent first", async () => {
    const out = await searchJobs(OFFICE, schedule(), q({ q: "melbourne", when: "past" }), NOW);
    expect(out.results.map((r) => r.job.id)).toEqual(["past"]);
    expect([out.from, out.to]).toEqual(["2026-04-12", "2026-10-08"]);
  });

  it("filters by crew, status and a pending readiness item; an unknown deposit counts as pending (D-003)", async () => {
    const ids = async (p: Record<string, string>) => (await searchJobs(OFFICE, schedule(), q(p), NOW)).results.map((r) => r.job.id);
    expect(await ids({ q: "hart", crew: "Crew 1" })).toEqual(["first"]);
    expect(await ids({ status: "Issue" })).toEqual(["later"]);
    expect(await ids({ needs: "Deposit" })).toEqual(["first", "later"]);
  });

  it("shows crew leads only their own crew, and ignores readiness filters they can't see", async () => {
    const out = await searchJobs(JORGE, schedule(), q({ q: "ha" }, JORGE), NOW);
    expect(out.results.every((r) => r.job.crew.startsWith("Crew 2"))).toBe(true);
    expect(() => q({ needs: "Deposit" }, JORGE)).toThrow(SearchError);
  });

  it("needs two letters or a filter, and rejects unknown filters", () => {
    expect(() => q({ q: "h" })).toThrow(/at least 2 letters/);
    expect(() => q({ q: "hart", crew: "Crew 9" })).toThrow(/Unknown crew/);
    expect(() => q({ status: "Paid" })).toThrow(/Unknown status/);
    expect(q({ q: "hart", when: "bogus" }).when).toBe("upcoming");
  });

  it("a job without a permit line does not count as permit pending", () => {
    expect(needsIt({ ...toControlJob(JOBS[1]), values: { Permit: undefined } }, "Permit")).toBe(false);
    expect(needsIt({ ...toControlJob(JOBS[1]), values: { Deposit: undefined } }, "Deposit")).toBe(true);
  });
});

describe("search API", () => {
  afterEach(() => {
    setUserStoreForTests(null);
    vi.unstubAllEnvs();
  });

  it("needs a session, answers without caching, and explains a too-short query", async () => {
    vi.stubEnv("CONTROL_USERS", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", ""); // sample data
    const store = new MemoryUserStore();
    await store.put({ ...OFFICE, password: hashPassword("office-pass-123", 100_000), createdAt: "t", createdBy: "test" });
    setUserStoreForTests(store);
    const cookie = `${CONTROL_COOKIE}=${sessionCookie((await store.get("diandra"))!)}`;
    const get = (qs: string, headers: Record<string, string> = { cookie }) =>
      SEARCH(new Request(`https://board.example.com/api/control/search?${qs}`, { headers }));

    expect((await get("q=hart", {})).status).toBe(401);
    const short = await get("q=h");
    expect(short.status).toBe(400);
    expect((await short.json()).error).toMatch(/at least 2 letters/);
    const ok = await get("status=Scheduled");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store, max-age=0");
    const body = (await ok.json()) as { total: number; results: { job: { values: { Status: string } } }[] };
    expect(body.total).toBeGreaterThan(0);
    expect(body.results.every((r) => r.job.values.Status === "Scheduled")).toBe(true);
  });
});
