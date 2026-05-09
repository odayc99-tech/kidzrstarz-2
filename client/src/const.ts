export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * KidzRstarz does not require login — customers use guest tokens.
 * This helper is kept so existing call sites compile without changes;
 * it simply returns the upload page URL.
 */
export const getLoginUrl = () => "/upload";
