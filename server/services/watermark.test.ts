import { describe, it, expect, vi } from "vitest";

// Mock sharp before importing the module
const mockMetadata = vi.fn().mockResolvedValue({ width: 1024, height: 1024 });
const mockPng = vi.fn().mockReturnThis();
const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from("watermarked-image"));
const mockComposite = vi.fn().mockReturnValue({ png: mockPng });

vi.mock("sharp", () => {
  const sharpFn = vi.fn(() => ({
    metadata: mockMetadata,
    composite: mockComposite,
  }));
  return { default: sharpFn };
});

// Now import the module under test
import { applyWatermark, applyBrandWatermark } from "./watermark";

describe("watermark utility", () => {
  it("applyWatermark returns a buffer", async () => {
    mockPng.mockReturnValue({ toBuffer: mockToBuffer });

    const inputBuffer = Buffer.from("test-image-data");
    const result = await applyWatermark(inputBuffer);

    expect(result).toBeInstanceOf(Buffer);
    expect(mockMetadata).toHaveBeenCalled();
    expect(mockComposite).toHaveBeenCalled();
  });

  it("applyWatermark SVG contains KidzRstarz text", async () => {
    mockPng.mockReturnValue({ toBuffer: mockToBuffer });

    const inputBuffer = Buffer.from("test-image-data");
    await applyWatermark(inputBuffer);

    // Check that composite was called with an SVG containing KidzRstarz
    const compositeCall = mockComposite.mock.calls[0][0];
    expect(compositeCall).toHaveLength(1);
    const svgInput = compositeCall[0].input.toString();
    expect(svgInput).toContain("KidzRstarz");
    expect(svgInput).toContain("rotate(-30");
  });

  it("applyWatermark returns original buffer on error", async () => {
    mockMetadata.mockRejectedValueOnce(new Error("sharp error"));

    const inputBuffer = Buffer.from("test-image-data");
    const result = await applyWatermark(inputBuffer);

    // Should return the original buffer on error
    expect(result).toBe(inputBuffer);
  });

  it("applyBrandWatermark returns a buffer with subtle brand mark", async () => {
    mockMetadata.mockResolvedValue({ width: 1024, height: 1024 });
    mockPng.mockReturnValue({ toBuffer: mockToBuffer });

    const inputBuffer = Buffer.from("test-image-data");
    const result = await applyBrandWatermark(inputBuffer);

    expect(result).toBeInstanceOf(Buffer);

    // Check that the SVG contains KidzRstarz and uses text-anchor end (bottom-right)
    const compositeCall = mockComposite.mock.calls[mockComposite.mock.calls.length - 1][0];
    const svgInput = compositeCall[0].input.toString();
    expect(svgInput).toContain("KidzRstarz");
    expect(svgInput).toContain("text-anchor=\"end\"");
  });

  it("applyBrandWatermark returns original buffer on error", async () => {
    mockMetadata.mockRejectedValueOnce(new Error("sharp error"));

    const inputBuffer = Buffer.from("test-image-data");
    const result = await applyBrandWatermark(inputBuffer);

    expect(result).toBe(inputBuffer);
  });

  it("watermark SVG scales font size based on image dimensions", async () => {
    // Test with a small image
    mockMetadata.mockResolvedValueOnce({ width: 256, height: 256 });
    mockPng.mockReturnValue({ toBuffer: mockToBuffer });

    const inputBuffer = Buffer.from("test-image-data");
    await applyWatermark(inputBuffer);

    const compositeCall = mockComposite.mock.calls[mockComposite.mock.calls.length - 1][0];
    const svgInput = compositeCall[0].input.toString();
    // Font size should be at least 24 (minimum) for a 256px image
    expect(svgInput).toContain('font-size="24"');
  });
});
