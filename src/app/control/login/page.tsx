import type { Metadata } from "next";
import { LoginForm } from "@/components/ControlLogin";

export const metadata: Metadata = { title: "Sign in · Job Status", robots: { index: false, follow: false } };

export default function LoginPage() {
  return <LoginForm />;
}
