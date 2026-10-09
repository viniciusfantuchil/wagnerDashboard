// Date and time helpers. The business runs on America/New_York regardless of where the code runs.

export const TZ = "America/New_York";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const hmFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Calendar date (YYYY-MM-DD) in New York for an instant. */
export function nyDate(at: Date): string {
  return dateFmt.format(at);
}

/** ISO string with the New York offset for a local date and "HH:MM" time, e.g. 2026-10-09T07:00:00-04:00. */
export function nyIso(date: string, hm: string): string {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const tz = offsetFmt.formatToParts(noonUtc).find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const offset = tz === "GMT" ? "+00:00" : tz.replace("GMT", "");
  return `${date}T${hm}:00${offset}`;
}

/** Shift a YYYY-MM-DD date by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for a YYYY-MM-DD date. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "Mon" for a YYYY-MM-DD date. */
export function weekdayShort(date: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday(date)];
}

/** "10/12" for a YYYY-MM-DD date. */
export function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** Splits "7:00 AM" into its clock and meridiem parts. */
export function clockParts(iso: string): { hm: string; ap: string } {
  const [hm, ap] = timeFmt.format(new Date(iso)).split(/\s/);
  return { hm, ap };
}

/** "7:00 AM" */
export function clock12(iso: string): string {
  const { hm, ap } = clockParts(iso);
  return `${hm} ${ap}`;
}

/** Minutes since local midnight in New York. */
export function minuteOfDay(iso: string): number {
  const [h, m] = hmFmt.format(new Date(iso)).split(":").map(Number);
  return (h % 24) * 60 + m;
}

/** "7a", "12p" */
export function hourShort(hour: number): string {
  return `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
}

/** "2–5 PM" or "11 AM–1 PM" for [startHour, endHour). */
export function hourRange(startHour: number, endHour: number): string {
  const h = (n: number) => n % 12 || 12;
  const ap = (n: number) => (n % 24 < 12 ? "AM" : "PM");
  return ap(startHour) === ap(endHour)
    ? `${h(startHour)}–${h(endHour)} ${ap(endHour)}`
    : `${h(startHour)} ${ap(startHour)}–${h(endHour)} ${ap(endHour)}`;
}
