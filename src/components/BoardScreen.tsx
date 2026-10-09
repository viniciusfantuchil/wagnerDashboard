"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_ALERTS, RAIN_ALERT_PCT, rainSummary } from "@/lib/rules/alerts";
import { clock12, clockParts, hourRange, hourShort, minuteOfDay, monthDay, TZ, weekdayShort } from "@/lib/time";
import type { Board, Check } from "@/lib/types";
import { BoardMap } from "./BoardMap";
import { STATUS_LABEL, statusKey } from "./status";

const REFRESH_MS = 5 * 60_000;
const CLOCK_MS = 15_000;
const STALE_RED_MIN = 15;
const MAX_JOBS = 10;
const BASE_FS = 18;
const MIN_FS = 13;
const RELOAD_MINUTE = 4 * 60; // 4:00 AM
const STAGE_H = 1080;
const WEATHER_PLACE = "Rockledge";
const MIN_STAGE_W = 1760; // narrower windows letterbox top and bottom
const MAX_STAGE_W = 2560; // wider windows letterbox left and right

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });

const COUNTS = ["in_progress", "scheduled", "issue", "completed"] as const;

function Mark({ v }: { v: Check }) {
  if (v === "ok") return <span className="y">✓</span>;
  if (v === "missing") return <span className="n">Missing</span>;
  return <span className="u">Unknown</span>;
}

function DepositChip({ v }: { v: Check }) {
  if (v === "ok") return <span className="chip c-ok">Deposit ok</span>;
  if (v === "missing") return <span className="chip c-none">No deposit</span>;
  return <span className="chip c-unknown">Deposit unknown</span>;
}

export function BoardScreen({ initial }: { initial: Board }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState(initial);
  const [failing, setFailing] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  // Refresh data without reloading the page; keep the last good board on failure.
  useEffect(() => {
    const refresh = async () => {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setBoard(await res.json());
        setFailing(false);
      } catch {
        setFailing(true);
      }
    };
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Clock, plus a daily reload at 4:00 AM to clear memory.
  useEffect(() => {
    const loadedAt = Date.now();
    const tick = () => {
      const t = new Date();
      setNow(t);
      const m = minuteOfDay(t.toISOString());
      if (m >= RELOAD_MINUTE && m < RELOAD_MINUTE + 5 && Date.now() - loadedAt > 60 * 60_000) location.reload();
    };
    tick();
    const id = setInterval(tick, CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  // Keep the TV awake.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator) lock = await navigator.wakeLock.request("screen");
      } catch {
        // Not granted (e.g. no user gesture or unsupported); the OS setting is the fallback.
      }
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      lock?.release().catch(() => {});
    };
  }, []);

  // Scale the stage to fit the window. Height is fixed at 1080 px; the width follows the window's shape within
  // limits, so a browser window fills edge to edge. On a 16:9 TV the stage is exactly 1920x1080.
  const fit = useCallback(() => {
    const st = stageRef.current;
    if (!st) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.round(Math.min(MAX_STAGE_W, Math.max(MIN_STAGE_W, (STAGE_H * vw) / vh)));
    const s = Math.min(vw / width, vh / STAGE_H);
    const x = (vw - width * s) / 2;
    const y = (vh - STAGE_H * s) / 2;
    st.style.width = `${width}px`;
    st.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }, []);

  // Shrink text only if a panel would overflow.
  const fitText = useCallback(() => {
    const st = stageRef.current;
    if (!st) return;
    let fs = BASE_FS;
    st.style.setProperty("--fs", `${fs}px`);
    const over = () => [...st.querySelectorAll<HTMLElement>(".panel")].some((p) => p.scrollHeight > p.clientHeight + 1);
    while (over() && fs > MIN_FS) {
      fs -= 0.5;
      st.style.setProperty("--fs", `${fs}px`);
    }
  }, []);
  useLayoutEffect(fitText, [board, fitText]);
  useLayoutEffect(() => {
    const onResize = () => {
      fit();
      fitText();
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit, fitText]);
  useEffect(() => {
    document.fonts?.ready.then(fitText);
  }, [fitText]);

  const { jobs, visits, weather, alerts, nextWorkday, sources } = board;
  const crews = new Set(jobs.map((j) => j.crew)).size;
  const counts = COUNTS.map((s) => ({ s, n: jobs.filter((j) => j.status === s).length }));
  const shownJobs = jobs.slice(0, MAX_JOBS);
  const shownAlerts = alerts.slice(0, MAX_ALERTS);

  const hourly = weather?.hourly ?? [];
  const hours = hourly.map((h) => Math.floor(minuteOfDay(h.start) / 60));
  const dayRain = rainSummary(hourly.filter((h) => h.pop !== null && h.pop >= RAIN_ALERT_PCT));
  const maxPop = Math.max(0, ...hourly.map((h) => h.pop ?? 0));
  const deg = (t: number | null | undefined) => (t === null || t === undefined ? "–" : `${t}°F`);

  const ageMin = now ? Math.max(0, Math.floor((now.getTime() - Date.parse(board.generatedAt)) / 60_000)) : 0;
  const stale = failing && ageMin >= STALE_RED_MIN;

  return (
    <div className="viewport">
      <div className="stage" id="stage" ref={stageRef}>
        <header>
          <div className="logo">
            <img src="/wagner-logo.png" alt="Wagner Pavers" />
          </div>
          <div className="title">
            <h1>Today&apos;s Operations</h1>
            <span>Brevard County</span>
          </div>
          {sources.sample && <span className="sample">Prototype · sample data</span>}
          <div className="wx-head" aria-label={`Weather in ${weather?.location ?? WEATHER_PLACE}`}>
            {weather ? (
              <>
                <b>{deg(weather.tempF)}</b>
                <span>
                  {weather.location} · {dayRain ?? `${maxPop}% rain max`}
                </span>
              </>
            ) : (
              <span>{WEATHER_PLACE} · weather unavailable</span>
            )}
          </div>
          <div className="clock">
            <span className="date">{now ? dateFmt.format(now) : ""}</span>
            <span className="time">{now ? timeFmt.format(now) : "--:--"}</span>
          </div>
        </header>

        <main>
          <section className="panel" aria-labelledby="h-map">
            <div className="panel-head">
              <h2 id="h-map">Map</h2>
              <span className="eyebrow">Today&apos;s jobs and estimates</span>
            </div>
            <div className="map-wrap">
              <BoardMap jobs={jobs} visits={visits} />
            </div>
            <div className="legend">
              <span><i style={{ background: "var(--warning)" }} />In progress</span>
              <span><i style={{ background: "var(--navy)" }} />Scheduled</span>
              <span><i style={{ background: "var(--success)" }} />Completed</span>
              <span><i style={{ background: "var(--red)" }} />Issue</span>
              <span><i style={{ background: "var(--ink-muted)" }} />Postponed</span>
              <span><i className="dia" />Estimate visit</span>
            </div>
          </section>

          <section className="panel" aria-labelledby="h-jobs">
            <div className="panel-head">
              <h2 id="h-jobs">Today&apos;s Jobs</h2>
              <span className="eyebrow">{jobs.length} jobs · {crews} crews</span>
            </div>
            <div className="counts">
              {counts.map(({ s, n }) => (
                <div key={s} className={`count ${statusKey(s)}`}>
                  <b>{n}</b>
                  <span>{STATUS_LABEL[s]}</span>
                </div>
              ))}
            </div>
            <div className="jobs">
              {shownJobs.length === 0 && <div className="empty">No jobs on the calendar today.</div>}
              {shownJobs.map((j) => {
                const { hm, ap } = clockParts(j.start);
                const k = statusKey(j.status);
                return (
                  <div key={j.id} className={`job ${j.status === "issue" ? "flag-issue" : ""}`}>
                    <span className={`num s-${k}`}>{j.pin}</span>
                    {j.allDay ? (
                      <span className="t all-day">All day</span>
                    ) : (
                      <span className="t">
                        {hm}
                        <small>{ap}</small>
                      </span>
                    )}
                    <span className="who">
                      {j.customer} <small>· {j.city}</small>
                    </span>
                    <span className="what">
                      <b>{j.crew}</b> · {j.service}
                      {j.size ? ` ${j.size}` : ""}
                      {j.day ? ` · day ${j.day.n} of ${j.day.of}` : ""}
                      {j.note ? (
                        <>
                          {" · "}
                          <em>{j.note}</em>
                        </>
                      ) : null}
                    </span>
                    <span className="tags">
                      <span className={`chip c-${k}`}>{STATUS_LABEL[j.status]}</span>
                      <DepositChip v={j.deposit} />
                    </span>
                  </div>
                );
              })}
              {jobs.length > shownJobs.length && <div className="more">+{jobs.length - shownJobs.length} more</div>}
            </div>
            <div className="sub">Estimate visits · Kevin</div>
            <div className="visits">
              {visits.map((v) => (
                <div key={v.id} className="v">
                  <span className="k">
                    <span>{v.key.slice(1)}</span>
                  </span>
                  <div>
                    <b>{v.allDay ? "All day" : clock12(v.start)}</b> {v.customer}
                    <small>
                      {v.city} · {v.service}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="col">
            <section className="panel" aria-labelledby="h-wx" style={{ flex: "none" }}>
              <div className="panel-head">
                <h2 id="h-wx">Rain by Hour</h2>
                <span className="eyebrow">
                  {weather?.location ?? WEATHER_PLACE}
                  {hours.length > 0 ? ` · ${hourRange(hours[0], hours[hours.length - 1])}` : ""}
                </span>
              </div>
              {weather ? (
                <>
                  <div className="rain">
                    {hourly.map((h) => (
                      <div key={h.start} title={h.pop === null ? "past" : `${h.pop}%`}>
                        {h.pop !== null && (
                          <i
                            className={h.pop >= RAIN_ALERT_PCT ? "hi" : ""}
                            style={{ height: `${Math.min(100, Math.max(6, (h.pop / 60) * 100))}%` }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="rain-h">
                    {hourly.map((h, i) => (
                      <span key={h.start}>
                        {hourShort(hours[i])}
                        <br />
                        {h.pop === null ? "–" : `${h.pop}%`}
                      </span>
                    ))}
                  </div>
                  <div className="wx-line">
                    <span>
                      High <b>{deg(weather.highF)}</b> · low <b>{deg(weather.lowF)}</b>
                    </span>
                    <span>
                      Lightning: <b>{weather.lightning ?? "none expected"}</b>
                    </span>
                    <span>
                      Wind <b>{weather.wind}</b>
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty">Forecast unavailable. Weather alerts are off until it is back.</div>
              )}
            </section>

            <section className="panel" aria-labelledby="h-alerts" style={{ flex: 1 }}>
              <div className="panel-head">
                <h2 id="h-alerts">Needs Attention</h2>
                <span className="eyebrow">{alerts.length} items</span>
              </div>
              <div className="alerts">
                {shownAlerts.map((a, i) => (
                  <div key={`${a.jobId}-${a.label}-${i}`} className={`alert ${a.severity === "danger" ? "danger" : "warn"}`}>
                    <span className="sev">{a.label}</span>
                    <b>{a.title}</b>
                    <p>{a.text}</p>
                  </div>
                ))}
                {alerts.length > shownAlerts.length && <div className="more">+{alerts.length - shownAlerts.length} more</div>}
              </div>
            </section>

            <section className="panel" aria-labelledby="h-next" style={{ flex: "none" }}>
              <div className="panel-head">
                <h2 id="h-next">
                  Ready Check · {weekdayShort(nextWorkday.date)} {monthDay(nextWorkday.date)}
                </h2>
                <span className="eyebrow">Next workday</span>
              </div>
              <table className="ready">
                <colgroup>
                  <col className="c1" />
                  <col />
                  <col />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Deposit</th>
                    <th>Permit</th>
                    <th>Material</th>
                    <th>48-h conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {nextWorkday.rows.length === 0 && (
                    <tr>
                      <td colSpan={5}>No jobs on the calendar.</td>
                    </tr>
                  )}
                  {nextWorkday.rows.map((r) => (
                    <tr key={r.jobId}>
                      <td>
                        <b>{r.customer}</b>
                        <small>
                          {r.city} · {r.crew}
                        </small>
                      </td>
                      <td><Mark v={r.deposit} /></td>
                      <td><Mark v={r.permit} /></td>
                      <td><Mark v={r.material} /></td>
                      <td><Mark v={r.confirm48} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </main>

        <footer>
          <span className="kpi"><b>{jobs.length}</b>jobs in the field</span>
          <span className="kpi"><b>{crews}</b>crews</span>
          <span className="kpi"><b>{visits.length}</b>estimate visits</span>
          {board.bookedThrough && (
            <span className="kpi"><b>Booked to {board.bookedThrough}</b>crew schedule</span>
          )}
          <span className={`src${stale ? " stale" : ""}`}>
            Schedule: {sources.schedule}. Weather: {sources.weather}.{" "}
            {failing ? `Last updated ${ageMin} min ago.` : `Updated ${clock12(board.generatedAt)}. Refreshes every 5 min.`}
          </span>
        </footer>
      </div>
    </div>
  );
}
