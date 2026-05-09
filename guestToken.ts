const GUEST_TOKEN_KEY = "kidzrstarz_guest_token";
const GUEST_TOKENS_KEY = "kidzrstarz_guest_tokens";

export function getGuestToken(): string | null {
  return localStorage.getItem(GUEST_TOKEN_KEY);
}

export function setGuestToken(token: string): void {
  localStorage.setItem(GUEST_TOKEN_KEY, token);
  // Also add to the list of all guest tokens
  const tokens = getAllGuestTokens();
  if (!tokens.includes(token)) {
    tokens.push(token);
    localStorage.setItem(GUEST_TOKENS_KEY, JSON.stringify(tokens));
  }
}

export function getAllGuestTokens(): string[] {
  try {
    const stored = localStorage.getItem(GUEST_TOKENS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function generateGuestToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
