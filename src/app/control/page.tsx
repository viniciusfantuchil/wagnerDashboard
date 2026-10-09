import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ControlScreen } from "@/components/ControlScreen";
import { controlUserFromCookie } from "@/lib/control/session";
import { CONTROL_COOKIE } from "@/lib/control/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Job Status · Wagner Pavers", robots: { index: false, follow: false } };

export default async function ControlPage() {
  const user = controlUserFromCookie((await cookies()).get(CONTROL_COOKIE)?.value);
  if (!user) {
    return (
      <div className="control-page">
        <p className="control-empty">Open your personal link from the office once on this phone.</p>
      </div>
    );
  }
  return <ControlScreen user={user} />;
}
