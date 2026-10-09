"use client";

import { useCallback, useEffect, useState } from "react";
import { FIELDS, type Field } from "@/lib/control/changes";
import type { ControlDay, ControlJob } from "@/lib/control/jobs";
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
}: {
  job: ControlJob;
  date: string;
  user: ControlUser;
  writable: boolean;
  onSaved: (j: ControlJob) => void;
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

export function ControlScreen({ user }: { user: ControlUser }) {
  const [days, setDays] = useState<ControlDay[] | null>(null);
  const [writable, setWritable] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const replace = (date: string, job: ControlJob) =>
    setDays((ds) => ds?.map((d) => (d.date === date ? { ...d, jobs: d.jobs.map((j) => (j.id === job.id ? job : j)) } : d)) ?? ds);

  return (
    <div className="control-page">
      <header className="control-head">
        <div>
          <h1>Job Status</h1>
          <p>
            {user.name} · {user.office ? "Office" : user.crew}
          </p>
        </div>
        <div className="control-actions">
          <button type="button" onClick={load}>
            Refresh
          </button>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              await fetch("/api/control/logout", { method: "POST" });
              location.href = "/control/login";
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {!writable && <p className="control-banner">Sample data: changes can&apos;t be saved until Google Calendar is connected.</p>}
      {error && <p className="control-banner error">{error}</p>}
      {!days && !error && <p className="control-empty">Loading…</p>}
      {days?.map((d, i) => (
        <section key={d.date} className="control-day">
          <h2>
            {i === 0 ? "Today" : "Next workday"} · {weekdayShort(d.date)} {monthDay(d.date)}
          </h2>
          {d.jobs.length === 0 && <p className="control-empty">No jobs on the calendar.</p>}
          {d.jobs.map((j) => (
            <JobCard key={j.id} job={j} date={d.date} user={user} writable={writable} onSaved={(job) => replace(d.date, job)} />
          ))}
        </section>
      ))}
    </div>
  );
}
