import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UsersScreen } from "@/components/UsersScreen";
import { controlUserFromCookie } from "@/lib/control/session";
import { CONTROL_COOKIE } from "@/lib/control/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Users · Job Status", robots: { index: false, follow: false } };

export default async function UsersPage() {
  const user = await controlUserFromCookie((await cookies()).get(CONTROL_COOKIE)?.value);
  if (!user) redirect("/control/login");
  if (!user.admin) redirect("/control");
  return <UsersScreen me={user} />;
}
