import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await buildBoard();
  return Response.json(board, { headers: { "Cache-Control": "no-store" } });
}
