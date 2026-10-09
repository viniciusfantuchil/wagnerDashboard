import { BoardScreen } from "@/components/BoardScreen";
import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <BoardScreen initial={await buildBoard()} />;
}
