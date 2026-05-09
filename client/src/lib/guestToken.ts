/**
 * Guest token management for unauthenticated users.
 * Stores a mapping of orderId → guestToken in localStorage
 * so guests can access their orders without logging in.
 */

const GUEST_TOKENS_KEY = "pixar_guest_tokens";

interface GuestTokenMap {
  [orderId: string]: string;
}

function getTokenMap(): GuestTokenMap {
  try {
    const raw = localStorage.getItem(GUEST_TOKENS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTokenMap(map: GuestTokenMap): void {
  localStorage.setItem(GUEST_TOKENS_KEY, JSON.stringify(map));
}

/**
 * Store a guest token for an order.
 */
export function saveGuestToken(orderId: number, guestToken: string): void {
  const map = getTokenMap();
  map[orderId.toString()] = guestToken;
  saveTokenMap(map);
}

/**
 * Get the guest token for an order (if any).
 */
export function getGuestToken(orderId: number): string | null {
  const map = getTokenMap();
  return map[orderId.toString()] || null;
}

/**
 * Get all stored guest tokens as an array of { orderId, guestToken }.
 */
export function getAllGuestTokens(): { orderId: number; guestToken: string }[] {
  const map = getTokenMap();
  return Object.entries(map).map(([id, token]) => ({
    orderId: parseInt(id),
    guestToken: token,
  }));
}

/**
 * Remove a guest token for an order (e.g., after linking to an account).
 */
export function removeGuestToken(orderId: number): void {
  const map = getTokenMap();
  delete map[orderId.toString()];
  saveTokenMap(map);
}
