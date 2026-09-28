import { describe, expect, it } from "vitest";
import { byteLength, MAX_CHUNK_BYTES, speechChunks } from "./speech";

describe("speech chunk boundaries", () => {
  for (const text of ["Привет, мир. ".repeat(1500).slice(0, 20000), "語😀".repeat(6666), "a".repeat(20000)]) {
    it(`preserves a long ${text.slice(0, 8)} answer without breaking Unicode`, () => {
      const chunks = speechChunks(text);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every(chunk => byteLength(chunk) <= MAX_CHUNK_BYTES)).toBe(true);
      expect(chunks.every(chunk => chunk.isWellFormed())).toBe(true);
      expect(chunks.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    });
  }
  it("rejects empty or oversized answers", () => {
    expect(speechChunks("   ")).toEqual([]);
    expect(speechChunks("a".repeat(20001))).toEqual([]);
  });
});
