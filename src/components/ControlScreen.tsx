"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FIELDS, VALUE_LABEL, type Changes, type Field } from "@/lib/control/changes";
import { attentionCounts, attentionMatch, canStop, nextStep, readinessChips, revertOf, STOP_REASONS, statusTone, type AttentionKey } from "@/lib/control/quick";
import type { ControlDay, ControlJob } from "@/lib/control/jobs";
import { MIN_QUERY, NEEDS, WINDOWS, type SearchResult, type SearchWindow } from "@/lib/control/searchOptions";
import { CREW_ORDER, crewRank } from "@/lib/crews";
import type { ControlUser } from "@/lib/control/users";
import { clock12, monthDay, weekdayShort } from "@/lib/time";

const CHECKS: { field: Exclude<Field, "Status" | "Note">; label: string }[] = [
  { field: "Deposit", label: "Payment" },
  { field: "Permit", label: "Permit" },
  { field: "Material", label: "Material" },
  { field: "Delivery", label: "Delivery" },
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
          {kind === "status" ? o : (VALUE_LABEL[o] ?? o)}
        </button>
      ))}
    </div>
  );
}

/** Saves changes to the job's calendar event and returns the job as saved. */
async function postChanges(job: ControlJob, date: string, changes: Changes): Promise<ControlJob> {
  const res = await fetch(`/api/control/jobs/${encodeURIComponent(job.id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ crew: job.crew, date, changes }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
  return body.job;
}

type Saved = (job: ControlJob, before: ControlJob, changes: Changes) => void;

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
  onSaved: Saved;
  showDate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(job.values.Note ?? "");
  const [reason, setReason] = useState("");
  useEffect(() => setNote(job.values.Note ?? ""), [job.values.Note]);
  const busy = saving || !writable;
  const status = job.values.Status ?? "Scheduled";
  const step = nextStep(status);

  const send = async (changes: Changes) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await postChanges(job, date, changes);
      onSaved(saved, job, changes);
      setStopping(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const pickCheck = (field: Field, value: string) => {
    if (field === "Deposit" && value === "OK" && !window.confirm("Mark the 50% deposit as received? Only when payment is confirmed (D-003).")) return;
    if (field === "Deposit" && value === "FINAL" && !window.confirm("Mark the final payment as received? Only when payment is confirmed.")) return;
    send({ [field]: value });
  };

  return (
    <article className={`cjob${open ? " open" : ""}`} style={{ borderLeftColor: job.color ?? "var(--border)" }}>
      <button type="button" className="cjob-sum" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="cjob-top">
          <span className="cjob-crew">
            <i style={{ background: job.color ?? "var(--ink-muted)" }} />
            {job.crew}
          </span>
          <span className="cjob-time">
            {showDate && <b className="cjob-date">{`${weekdayShort(date)} ${monthDay(date)} · `}</b>}
            {job.allDay ? "All day" : clock12(job.start)}
            {job.routeOrder !== undefined ? ` · stop ${job.routeOrder}` : ""}
          </span>
        </span>
        <span className="cjob-name">
          {job.customer} <small>· {job.city}</small>
        </span>
        <span className="cjob-what">
          {job.service}
          {job.size ? ` ${job.size}` : ""}
        </span>
        <span className="cjob-chips">
          <span className={`chip st-${statusTone(status)}`}>{status}</span>
          {user.office &&
            readinessChips(job).map((c) => (
              <span key={c.field} className={`chip t-${c.tone}`}>
                {c.label}
              </span>
            ))}
          {job.warnings.length > 0 && <span className="chip t-warn">Calendar ⚠</span>}
        </span>
        {job.values.Note && (
          <span className={`cjob-notebox${status === "Issue" ? " issue" : ""}`}>
            <b>{status === "Issue" ? "Stopped" : "Note"}</b>
            {job.values.Note}
          </span>
        )}
        <span className="cjob-chev" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {!open && !stopping && (step || canStop(status)) && (
        <div className="cjob-quick">
          {step && (
            <button type="button" className={`q-step q-${step.label.toLowerCase()}`} disabled={busy} onClick={() => send({ Status: step.status })}>
              {saving ? "Saving…" : step.label}
            </button>
          )}
          {canStop(status) && (
            <button type="button" className="q-stop" disabled={busy} onClick={() => setStopping(true)}>
              Issue
            </button>
          )}
        </div>
      )}

      {stopping && (
        <div className="cjob-stop">
          <p>Why is the job stopped?</p>
          <div className="cjob-reasons">
            {STOP_REASONS.map((r) => (
              <button key={r} type="button" className={reason === r ? "on" : ""} disabled={busy} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          <input value={reason} maxLength={200} placeholder="Or type the reason" onChange={(e) => setReason(e.target.value)} disabled={busy} />
          <div className="cjob-quick">
            <button type="button" className="q-stop on" disabled={busy || !reason.trim()} onClick={() => send({ Status: "Issue", Note: reason })}>
              {saving ? "Saving…" : "Mark stopped"}
            </button>
            <button type="button" className="q-cancel" disabled={saving} onClick={() => setStopping(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="cjob-edit">
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
            <textarea
              value={note}
              maxLength={200}
              rows={2}
              placeholder={job.values.Status === "Issue" ? "Why is the job stopped?" : "Note for the board"}
              disabled={!writable}
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="button" disabled={busy || note.trim() === (job.values.Note ?? "")} onClick={() => send({ Note: note })}>
              Save note
            </button>
          </div>

          {job.warnings.length > 0 && <p className="cjob-warn">Calendar: {job.warnings.join("; ")}</p>}
          {job.updated && <p className="cjob-updated">Last change: {job.updated}</p>}
          {saving && <p className="cjob-save">Saving…</p>}
        </div>
      )}

      {error && <p className="cjob-save error">{error}</p>}
    </article>
  );
}

type Results = { results: SearchResult[]; total: number; from: string; to: string };

const WHEN_LABEL: Record<SearchWindow, string> = { upcoming: "Upcoming", past: "Past", all: "Past and upcoming" };
const NEEDS_LABEL: Record<(typeof NEEDS)[number], string> = {
  Deposit: "Deposit pending",
  Permit: "Permit not approved",
  Material: "Material not ordered",
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
  const [focus, setFocus] = useState<AttentionKey | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; undo?: () => void; error?: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), 6000);
    return () => clearTimeout(t);
  }, [toast]);
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

  /** After a save: update the card, and offer Undo for a few seconds. */
  const saved = (date: string, job: ControlJob, before: ControlJob, changes: Changes) => {
    replace(date, job);
    const what = Object.entries(changes)
      .map(([f, v]) => (f === "Note" ? (v ? "note saved" : "note cleared") : f === "Status" ? v : `${f === "Confirm48" ? "48h" : f} ${v}`))
      .join(", ");
    const revert = revertOf(before, changes);
    const id = Date.now();
    setToast({
      id,
      text: `${job.customer}: ${what}. Saved to the calendar.`,
      undo:
        Object.keys(revert).length > 0
          ? async () => {
              setToast({ id: id + 1, text: "Undoing…" });
              try {
                replace(date, await postChanges(job, date, revert));
                setToast({ id: id + 2, text: `${job.customer}: change undone.` });
              } catch (err) {
                setToast({ id: id + 2, text: err instanceof Error ? err.message : "Could not undo", error: true });
              }
            }
          : undefined,
    });
  };

  const clear = () => {
    setQ("");
    setStatus("");
    setNeeds("");
  };
  const ofCrew = (j: ControlJob) => !crew || crewRank(j.crew) === CREW_ORDER.indexOf(crew);
  const card = (j: ControlJob, date: string, showDate = false) => (
    <JobCard
      key={`${date}-${j.id}`}
      job={j}
      date={date}
      user={user}
      writable={writable}
      showDate={showDate}
      onSaved={(job, before, changes) => saved(date, job, before, changes)}
    />
  );
  const attention = days ? attentionCounts(days.map((d) => ({ ...d, jobs: d.jobs.filter(ofCrew) })), user.office) : [];

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
            {days && (
              <nav className="control-attn" aria-label="Needs attention">
                <span className="control-attn-title">Needs attention</span>
                {attention.length === 0 && <span className="chip t-ok">All set for today and the next workday ✓</span>}
                {attention.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className={`chip t-${a.tone}${focus === a.key ? " on" : ""}`}
                    aria-pressed={focus === a.key}
                    onClick={() => setFocus((f) => (f === a.key ? null : a.key))}
                  >
                    {a.label}
                  </button>
                ))}
                {focus && (
                  <button type="button" className="control-attn-all" onClick={() => setFocus(null)}>
                    Show all jobs
                  </button>
                )}
              </nav>
            )}
            {days?.map((d, i) => {
              const jobs = d.jobs.filter(ofCrew).filter((j) => !focus || attentionMatch(focus, j, i > 0));
              if (focus && jobs.length === 0) return null;
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

      {toast && (
        <div className={`control-toast${toast.error ? " error" : ""}`} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
