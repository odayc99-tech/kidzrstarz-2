import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("framer-motion", () => ({ motion: { div: "div" }, AnimatePresence: ({ children }: any) => children }));
import { StoryPlayer } from "../client/src/components/StoryPlayer";
beforeEach(() => { vi.stubGlobal("React", React); });
afterEach(() => { vi.unstubAllGlobals(); });
const scene = { id: 1, sceneIndex: 0, sceneText: "A mock scene", illustrationUrl: null, narrationUrl: null };
describe("private scene player states", () => {
  it("shows a terminal generation error rather than a spinner for failed scenes", () => { const html = renderToStaticMarkup(React.createElement(StoryPlayer, { childName: "Test", scenes: [{ ...scene, status: "failed" }] })); expect(html).toContain("Scene generation encountered an error"); expect(html).not.toContain("Generating scenes..."); });
  it("shows a refreshable access error for completed scenes with unavailable links", () => { const html = renderToStaticMarkup(React.createElement(StoryPlayer, { childName: "Test", scenes: [{ ...scene, status: "completed" }] })); expect(html).toContain("Scene images are temporarily unavailable"); expect(html).not.toContain("Generating scenes..."); });
  it("keeps the progress state for genuinely pending work", () => { const html = renderToStaticMarkup(React.createElement(StoryPlayer, { childName: "Test", scenes: [{ ...scene, status: "pending" }] })); expect(html).toContain("Generating scenes..."); });
});
