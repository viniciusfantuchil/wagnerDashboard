// Crew names come from the calendar names, e.g. "Crew 2 · Jorge", "Felipe", "Sealing · Jardel".

/** Board order of the crews. Pins are numbered in this order, then by start time. */
export const CREW_ORDER = ["Crew 1", "Crew 2", "Crew 3", "Crew 4", "Felipe", "Excavation", "Sealing"];

/**
 * Crew colors, as set on the crews' Google calendars (Google Calendar palette). The office tells crews apart
 * by these colors, so the board shows them too: a stripe on the job card and a ring around the map pin.
 * The general "Wagner Pavers" calendar is Felipe's.
 */
export const CREW_COLORS: Record<string, string> = {
  "Crew 1": "#f4511e", // Tangerine
  "Crew 2": "#8e24aa", // Grape
  "Crew 3": "#33b679", // Sage
  "Crew 4": "#7cb342", // Pistachio
  Felipe: "#039be5", // Peacock
  Excavation: "#d50000", // Tomato
  Sealing: "#3f51b5", // Blueberry
};

/** The crew's calendar color, or undefined for a calendar the board does not know. */
export function crewColor(crew: string): string | undefined {
  const i = crewRank(crew);
  return i < CREW_ORDER.length ? CREW_COLORS[CREW_ORDER[i]] : undefined;
}

export function crewRank(crew: string): number {
  const i = CREW_ORDER.findIndex((c) => crew === c || crew.startsWith(`${c} `));
  return i === -1 ? CREW_ORDER.length : i;
}

/** The person who leads the crew: "Crew 2 · Jorge" → "Jorge", "Felipe" → "Felipe". */
export function crewLead(crew: string): string {
  const parts = crew.split("·").map((s) => s.trim());
  return parts[parts.length - 1];
}

/** Short label for tables: "Crew 2 · Jorge" → "Crew 2", "Excavation · Bira" → "Bira". */
export function crewShort(crew: string): string {
  const head = crew.split("·")[0].trim();
  return /^Crew \d+$/.test(head) ? head : crewLead(crew);
}
