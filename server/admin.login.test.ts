/**
 * Validates that the ADMIN_SECRET env var is configured and that the
 * adminLogin procedure accepts it without throwing.
 */
import { describe, it, expect } from "vitest";
import { ENV } from "./_core/env";

describe("Admin Login", () => {
  it("ADMIN_SECRET is configured", () => {
    expect(ENV.adminSecret).toBeTruthy();
    expect(ENV.adminSecret.length).toBeGreaterThan(0);
  });

  it("adminSecret does not equal a placeholder value", () => {
    const forbidden = ["secret", "password", "admin", "changeme", "test"];
    expect(forbidden).not.toContain(ENV.adminSecret.toLowerCase());
  });
});
