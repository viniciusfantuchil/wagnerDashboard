import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ControlScreen } from "@/components/ControlScreen";
import { controlUserFromCookie } from "@/lib/control/session";
import { CONTROL_COOKIE } from "@/lib/control/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Job Status · Wagner Pavers", robots: { index: false, follow: false } };

export default async function ControlPage() {
  const user = await controlUserFromCookie((await cookies()).get(CONTROL_COOKIE)?.value);
  if (!user) redirect("/control/login");
  return <ControlScreen user={user} />;
}
