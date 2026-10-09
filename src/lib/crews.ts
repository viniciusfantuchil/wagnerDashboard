// Crew names come from the calendar names, e.g. "Crew 2 · Jorge", "Felipe", "Sealing · Jardel".

/** Board order of the crews. Pins are numbered in this order, then by start time. */
export const CREW_ORDER = ["Crew 1", "Crew 2", "Crew 3", "Crew 4", "Felipe", "Excavation", "Sealing"];

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
