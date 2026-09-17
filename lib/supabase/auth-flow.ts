// Shared constant/type for the short-lived "auth flow" marker cookie set by
// app/auth/confirm/route.ts. Current Supabase Auth no longer encodes the flow
// ("recovery" / "invite") in the JWT amr claim, so we keep our own server-set
// hint. The cookie is httpOnly — read/clear it via the server actions in
// app/auth/auth-flow-actions.ts, never from the browser (a JS-writable marker
// would let a recovery session tamper with the middleware forced-reset gate).

export const AUTH_FLOW_COOKIE = "sb_auth_flow";

export type AuthFlow = "recovery" | "invite";
