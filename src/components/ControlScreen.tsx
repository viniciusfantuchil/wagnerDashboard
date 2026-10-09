"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FIELDS, type Field } from "@/lib/control/changes";
import type { ControlDay, ControlJob } from "@/lib/control/jobs";
import { MIN_QUERY, NEEDS, WINDOWS, type SearchResult, type SearchWindow } from "@/lib/control/searchOptions";
import { CREW_ORDER, crewRank } from "@/lib/crews";
import type { ControlUser } from "@/lib/control/users";
import { clock12, monthDay, weekdayShort } from "@/lib/time";

type Save = { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

const CHECKS: { field: Exclude<Field, "Status" | "Note">; label: string }[] = [
  { field: "Deposit", label: "Deposit" },
  { field: "Permit", label: "Permit" },
  { field: "Material", label: "Material" },
  { field: "Confirm48", label: "48-h conf." },
];

function Segmented({
  options,
  value,
  disabled,
  onPick,
  kind,
}: {
  options: readonly string[];
  value?: string;
  disabled: boolean;
  onPick: (v: string) => void;
  kind?: "status";
}) {
  return (
    <div className={`seg${kind ? ` seg-${kind}` : ""}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          className={value === o ? `on v-${o.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}
          disabled={disabled}
          onClick={() => value !== o && onPick(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function JobCard({
  job,
  date,
  user,
  writable,
  onSaved,
  showDate,
}: {
  job: ControlJob;
  date: string;
  user: ControlUser;
  writable: boolean;
  onSaved: (j: ControlJob) => void;
  showDate?: boolean;
}) {
  const [save, setSave] = useState<Save | null>(null);
  const [note, setNote] = useState(job.values.Note ?? "");
  useEffect(() => setNote(job.values.Note ?? ""), [job.values.Note]);
  const busy = save?.state === "saving" || !writable;

  const send = async (changes: Partial<Record<Field, string>>) => {
    setSave({ state: "saving" });
    try {
      const res = await fetch(`/api/control/jobs/${encodeURIComponent(job.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crew: job.crew, date, changes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      onSaved(body.job);
      setSave({ state: "saved" });
    } catch (err) {
      setSave({ state: "error", message: err instanceof Error ? err.message : "Could not save" });
    }
  };

  const pickCheck = (field: Field, value: string) => {
    if (field === "Deposit" && value === "OK" && !window.confirm("Mark the 50% deposit as received? Only when payment is confirmed (D-003).")) return;
    send({ [field]: value });
  };

  return (
    <article className="cjob" style={{ borderLeftColor: job.color ?? "var(--border)" }}>
      <header>
        <span className="cjob-crew">
          <i style={{ background: job.color ?? "var(--ink-muted)" }} />
          {job.crewShort}
        </span>
        <span className="cjob-time">
          {showDate && <b className="cjob-date">{`${weekdayShort(date)} ${monthDay(date)} · `}</b>}
          {job.allDay ? "All day" : clock12(job.start)}
          {job.routeOrder !== undefined ? ` · stop ${job.routeOrder}` : ""}
        </span>
      </header>
      <h3>
        {job.customer} <small>· {job.city}</small>
      </h3>
      <p className="cjob-what">
        {job.service}
        {job.size ? ` ${job.size}` : ""}
      </p>

      <Segmented kind="status" options={FIELDS.Status} value={job.values.Status} disabled={busy} onPick={(v) => send({ Status: v })} />

      {user.office && (
        <div className="cjob-checks">
          {CHECKS.map(({ field, label }) => (
            <div key={field} className="cjob-check">
              <span>{label}</span>
              <Segmented options={FIELDS[field]} value={job.values[field]} disabled={busy} onPick={(v) => pickCheck(field, v)} />
            </div>
          ))}
        </div>
      )}

      <div className="cjob-note">
        <input
          value={note}
          maxLength={200}
          placeholder={job.values.Status === "Issue" ? "Why is the job stopped?" : "Note for the board"}
          disabled={!writable}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" disabled={busy || note.trim() === (job.values.Note ?? "")} onClick={() => send({ Note: note })}>
          Save note
        </button>
      </div>

      {job.warnings.length > 0 && <p className="cjob-warn">Calendar: {job.warnings.join("; ")}</p>}
      {save && (
        <p className={`cjob-save ${save.state}`}>
          {save.state === "saving" ? "Saving…" : save.state === "saved" ? "Saved to the calendar ✓" : save.message}
        </p>
      )}
    </article>
  );
}

type Results = { results: SearchResult[]; total: number; from: string; to: string };

const WHEN_LABEL: Record<SearchWindow, string> = { upcoming: "Upcoming", past: "Past", all: "Past and upcoming" };
const NEEDS_LABEL: Record<(typeof NEEDS)[number], string> = {
  Deposit: "Deposit pending",
  Permit: "Permit pending",
  Material: "Material pending",
  Confirm48: "48-h conf. pending",
};

function dayCounts(jobs: ControlJob[]) {
  const issues = jobs.filter((j) => j.values.Status === "Issue").length;
  return `${jobs.length} job${jobs.length === 1 ? "" : "s"}${issues ? ` · ${issues} stopped` : ""}`;
}

export function ControlScreen({ user }: { user: ControlUser }) {
  const [days, setDays] = useState<ControlDay[] | null>(null);
  const [writable, setWritable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and filters. The crew filter also narrows today and the next workday.
  const [q, setQ] = useState("");
  const [when, setWhen] = useState<SearchWindow>("upcoming");
  const [crew, setCrew] = useState("");
  const [status, setStatus] = useState("");
  const [needs, setNeeds] = useState("");
  const [found, setFound] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const searchActive = q.trim().length >= MIN_QUERY || !!status || !!needs;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/control/jobs", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      setDays(body.days);
      setWritable(body.writable);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the jobs");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!searchActive) {
      setFound(null);
      setSearchError(null);
      return;
    }
    const params = new URLSearchParams({ q: q.trim(), when, ...(crew && { crew }), ...(status && { status }), ...(needs && { needs }) });
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch(`/api/control/search?${params}`, { cache: "no-store", signal: ctrl.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
        setFound(body);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setSearchError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, when, crew, status, needs, searchActive]);

  // "/" jumps to the search box on a computer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const replace = (date: string, job: ControlJob) => {
    setDays((ds) => ds?.map((d) => (d.date === date ? { ...d, jobs: d.jobs.map((j) => (j.id === job.id ? job : j)) } : d)) ?? ds);
    setFound((f) => f && { ...f, results: f.results.map((r) => (r.job.id === job.id && r.date === date ? { ...r, job } : r)) });
  };
  const clear = () => {
    setQ("");
    setStatus("");
    setNeeds("");
  };
  const ofCrew = (j: ControlJob) => !crew || crewRank(j.crew) === CREW_ORDER.indexOf(crew);
  const card = (j: ControlJob, date: string, showDate = false) => (
    <JobCard key={`${date}-${j.id}`} job={j} date={date} user={user} writable={writable} showDate={showDate} onSaved={(job) => replace(date, job)} />
  );

  return (
    <div className="control-page">
      <header className="control-head">
        <div>
          <h1>Job Status</h1>
          <p>
            {user.name} · {user.admin ? "Admin" : user.office ? "Office" : user.crew}
          </p>
        </div>
        <div className="control-actions">
          {user.admin && (
            <a className="control-link" href="/control/users">
              Users
            </a>
          )}
          <button type="button" onClick={load}>
            Refresh
          </button>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              await fetch("/api/control/logout", { method: "POST", cache: "no-store" });
              location.replace("/control/login");
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="control-main">
        <form className="control-search" role="search" onSubmit={(e) => e.preventDefault()}>
          <input
            ref={searchBox}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search jobs: customer, city, service, note…"
            aria-label="Search jobs"
            autoComplete="off"
            spellCheck={false}
          />
          <select value={when} onChange={(e) => setWhen(e.target.value as SearchWindow)} aria-label="When">
            {(Object.keys(WINDOWS) as SearchWindow[]).map((w) => (
              <option key={w} value={w}>
                {WHEN_LABEL[w]}
              </option>
            ))}
          </select>
          {user.office && (
            <select value={crew} onChange={(e) => setCrew(e.target.value)} aria-label="Crew">
              <option value="">All crews</option>
              {CREW_ORDER.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {FIELDS.Status.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {user.office && (
            <select value={needs} onChange={(e) => setNeeds(e.target.value)} aria-label="Needs">
              <option value="">Any readiness</option>
              {NEEDS.map((n) => (
                <option key={n} value={n}>
                  {NEEDS_LABEL[n]}
                </option>
              ))}
            </select>
          )}
          {searchActive && (
            <button type="button" className="control-clear" onClick={clear}>
              Clear
            </button>
          )}
        </form>

        {!writable && <p className="control-banner">Sample data: changes can&apos;t be saved until Google Calendar is connected.</p>}
        {error && <p className="control-banner error">{error}</p>}

        {searchActive ? (
          <section className="control-results" aria-live="polite">
            <h2 className="control-results-head">
              {searching && !found
                ? "Searching…"
                : found
                  ? `${found.total} job${found.total === 1 ? "" : "s"} · ${WHEN_LABEL[when].toLowerCase()}${found.total > found.results.length ? ` · showing the first ${found.results.length}` : ""}`
                  : "Search"}
            </h2>
            {searchError && <p className="control-banner error">{searchError}</p>}
            {found?.total === 0 && <p className="control-empty">No jobs match. Try fewer letters, or Past and upcoming.</p>}
            {found && <div className="cjobs">{found.results.map((r) => card(r.job, r.date, true))}</div>}
          </section>
        ) : (
          <>
            {!days && !error && <p className="control-empty">Loading…</p>}
            {days?.map((d, i) => {
              const jobs = d.jobs.filter(ofCrew);
              return (
                <section key={d.date} className="control-day">
                  <h2>
                    {i === 0 ? "Today" : "Next workday"} · {weekdayShort(d.date)} {monthDay(d.date)}
                    <small>{dayCounts(jobs)}</small>
                  </h2>
                  {jobs.length === 0 && <p className="control-empty">No jobs on the calendar.</p>}
                  <div className="cjobs">{jobs.map((j) => card(j, d.date))}</div>
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
