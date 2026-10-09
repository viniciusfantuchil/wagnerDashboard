import type { Metadata } from "next";
import { BoardLoginForm } from "@/components/ControlLogin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up this screen · Wagner Pavers", robots: { index: false, follow: false } };

export default function BoardLoginPage() {
  return <BoardLoginForm />;
}
