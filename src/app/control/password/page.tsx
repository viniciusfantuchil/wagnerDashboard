import type { Metadata } from "next";
import { PasswordHashTool } from "@/components/ControlLogin";

export const metadata: Metadata = { title: "Make a password hash · Job Status", robots: { index: false, follow: false } };

export default function PasswordPage() {
  return <PasswordHashTool />;
}
