import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const board = await buildBoard();
    return Response.json(board, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // The screen keeps its last good board and shows "Last updated N min ago".
    console.error("GET /api/board failed:", err);
    return Response.json({ error: "Board data unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
