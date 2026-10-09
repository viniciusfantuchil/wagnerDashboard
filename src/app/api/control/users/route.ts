import { AdminError, createUser, listUsers } from "@/lib/control/admin";
import { controlUserFromRequest, envUsers, NO_STORE, sameOrigin } from "@/lib/control/session";
import { getUserStore, StoreError } from "@/lib/control/store";

export const dynamic = "force-dynamic";

async function admin(request: Request) {
  const user = await controlUserFromRequest(request);
  return user?.admin ? user : null;
}

export async function GET(request: Request) {
  if (!(await admin(request))) return Response.json({ error: "Admins only" }, { status: 403, headers: NO_STORE });
  const store = getUserStore();
  try {
    return Response.json({ users: await listUsers(store, envUsers()), storeConnected: !!store }, { headers: NO_STORE });
  } catch (err) {
    console.error("List users failed:", err);
    return Response.json({ error: err instanceof StoreError ? err.hint : "Could not read the users" }, { status: 502, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Bad origin" }, { status: 403, headers: NO_STORE });
  const by = await admin(request);
  if (!by) return Response.json({ error: "Admins only" }, { status: 403, headers: NO_STORE });
  const store = getUserStore();
  if (!store) return Response.json({ error: "Set USERS_SHEET_ID in Vercel to add users." }, { status: 503, headers: NO_STORE });
  try {
    const user = await createUser(store, envUsers(), await request.json(), by);
    console.info(`Control users: ${by.name} added ${user.username} (${user.role})`);
    return Response.json({ user }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof AdminError) return Response.json({ error: err.message }, { status: err.status, headers: NO_STORE });
    console.error("Add user failed:", err);
    return Response.json({ error: err instanceof StoreError ? err.hint : "Could not add the user" }, { status: 502, headers: NO_STORE });
  }
}
