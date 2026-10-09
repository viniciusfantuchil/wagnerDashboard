// Search options shared by the control screen (browser) and the search API. No server code here.

import type { ControlJob } from "./jobs";

/** Date windows, in days from today: [first, last]. */
export const WINDOWS = {
  upcoming: [0, 180],
  past: [-180, -1],
  all: [-180, 180],
} as const;
export type SearchWindow = keyof typeof WINDOWS;

/** "Needs" filter: a readiness item that is not done yet. Office only, like the items themselves. */
export const NEEDS = ["Deposit", "Permit", "Material", "Confirm48"] as const;
export type Need = (typeof NEEDS)[number];

export const RESULT_LIMIT = 60;
export const MIN_QUERY = 2;

export interface SearchResult {
  date: string;
  job: ControlJob;
}
