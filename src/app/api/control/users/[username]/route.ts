import { AdminError, removeUser, updateUser } from "@/lib/control/admin";
import { controlUserFromRequest, envUsers, NO_STORE, sameOrigin } from "@/lib/control/session";
import { getUserStore } from "@/lib/control/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ username: string }> };

async function guard(request: Request) {
  if (!sameOrigin(request)) return { error: Response.json({ error: "Bad origin" }, { status: 403, headers: NO_STORE }) };
  const by = await controlUserFromRequest(request);
  if (!by?.admin) return { error: Response.json({ error: "Admins only" }, { status: 403, headers: NO_STORE }) };
  const store = getUserStore();
  if (!store) return { error: Response.json({ error: "Set USERS_SHEET_ID in Vercel to manage users." }, { status: 503, headers: NO_STORE }) };
  return { by, store };
}

const fail = (err: unknown) => {
  if (err instanceof AdminError) return Response.json({ error: err.message }, { status: err.status, headers: NO_STORE });
  console.error("User change failed:", err);
  return Response.json({ error: "Could not save the change" }, { status: 502, headers: NO_STORE });
};

/** Change a user's name, role or password. A new password signs that person out everywhere. */
export async function PATCH(request: Request, { params }: Ctx) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { username } = await params;
  try {
    const user = await updateUser(g.store, envUsers(), decodeURIComponent(username).toLowerCase(), await request.json(), g.by);
    console.info(`Control users: ${g.by.name} changed ${user.username}`);
    return Response.json({ user }, { headers: NO_STORE });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { username } = await params;
  try {
    await removeUser(g.store, envUsers(), decodeURIComponent(username).toLowerCase(), g.by);
    console.info(`Control users: ${g.by.name} removed ${username}`);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return fail(err);
  }
}
