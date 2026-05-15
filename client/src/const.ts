export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Hardcoded fallbacks — App ID and OAuth portal URL are not secrets.
// VITE_ env vars are only available if set at Vite build time; these fallbacks
// ensure the login URL always works regardless of build environment.
const DEFAULT_OAUTH_PORTAL_URL = "https://oauth.manus.im";
const DEFAULT_APP_ID = "835adef1-337f-4e92-9b60-7419098df44d";

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl =
    import.meta.env.VITE_OAUTH_PORTAL_URL || DEFAULT_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID || DEFAULT_APP_ID;

  try {
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const state = btoa(redirectUri);

    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");

    return url.toString();
  } catch {
    return "#";
  }
};
