import type { Sky } from "@/lib/types";

const CLOUD = "M7 18.5h10.5a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 7.4 9.2 4.65 4.65 0 0 0 7 18.5Z";

/** Small weather pictures for the board, drawn with the design tokens (no external icons). */
export function WeatherIcon({ sky, size = 24, title }: { sky?: Sky; size?: number; title?: string }) {
  if (!sky) return <span className="wx-icon" style={{ width: size, height: size }} aria-hidden />;
  const label = title ?? { sun: "Sunny", partly: "Partly sunny", cloud: "Cloudy", rain: "Rain", storm: "Thunderstorms" }[sky];
  return (
    <svg className={`wx-icon wx-${sky}`} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label}>
      {(sky === "sun" || sky === "partly") && (
        <g className="sun" transform={sky === "partly" ? "translate(-3.5 -3.5) scale(.8)" : undefined}>
          <circle cx="12" cy="12" r="4.6" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="12" y1="3.2" x2="12" y2="5.4" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      )}
      {sky !== "sun" && <path className="cloud" d={sky === "partly" ? CLOUD.replace("M7 18.5", "M7 19.5") : CLOUD} transform={sky === "cloud" || sky === "partly" ? undefined : "translate(0 -3)"} />}
      {sky === "rain" && (
        <g className="drops">
          <line x1="8.5" y1="18" x2="7.5" y2="21" />
          <line x1="12.5" y1="18" x2="11.5" y2="21" />
          <line x1="16.5" y1="18" x2="15.5" y2="21" />
        </g>
      )}
      {sky === "storm" && <path className="bolt" d="M12.8 14.5 9.8 19h2.6l-1.4 4 4.2-5.6h-2.7l1.6-2.9Z" />}
    </svg>
  );
}
