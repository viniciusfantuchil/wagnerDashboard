"use client";

import { useEffect } from "react";

const RETRY_MS = 60_000;

/** First load failed (e.g. Google Calendar unreachable). Retry on a timer; the TV has no one to press a button. */
export default function BoardError({ reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    const id = setTimeout(() => location.reload(), RETRY_MS);
    return () => clearTimeout(id);
  }, [reset]);

  return (
    <div className="viewport">
      <div className="board-error">
        <h1>Board unavailable</h1>
        <p>Could not load the schedule. Retrying in 1 minute.</p>
      </div>
    </div>
  );
}
