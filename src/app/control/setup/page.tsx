import type { Metadata } from "next";
import { SetupForm } from "@/components/ControlLogin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "First admin · Job Status", robots: { index: false, follow: false } };

export default function SetupPage() {
  return <SetupForm />;
}
