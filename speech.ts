export const MAX_TEXT = 20_000;
// UTF-8 bytes bound byte-level tokens conservatively, including CJK and emoji.
// Leave room for instructions within the model's 2,000 input-token limit.
export const MAX_CHUNK_BYTES = 1800;
export const speechInstructions = "Speak naturally in the language of the input text. For Russian, use clear, warm Russian pronunciation.";
export const byteLength = (text: string) => new TextEncoder().encode(text).length;

export function speechChunks(text: string): string[] {
  let remaining = text.trim();
  if (!remaining || remaining.length > MAX_TEXT) return [];
  const chunks: string[] = [];
  while (remaining) {
    let end = 0;
    let bytes = 0;
    for (const character of remaining) {
      bytes += byteLength(character);
      if (bytes > MAX_CHUNK_BYTES) break;
      end += character.length;
    }
    if (end < remaining.length) {
      const prefix = remaining.slice(0, end);
      const boundaries = [...prefix.matchAll(/\s+/g)];
      const boundary = boundaries.at(-1)?.index ?? 0;
      if (boundary > end / 2) end = boundary;
    }
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }
  return chunks;
}
