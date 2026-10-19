// Builds the Supabase auth cookie the admin app expects, for a mock user.
// Only accepted by tests/mock/server.mjs.

export const MOCK_URL = "http://localhost:54399";

export function sessionCookie(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const claims = { sub: user.id, role: "authenticated", email: user.email, exp };
  const accessToken = `mock.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x`;
  const session = {
    access_token: accessToken,
    refresh_token: "mock-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated" },
  };
  return {
    name: "sb-localhost-auth-token",
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  };
}
