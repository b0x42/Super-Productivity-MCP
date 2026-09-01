// Full request/response capture is unbounded by nature — get_tasks returns the
// user's entire task list. Oversized payloads are replaced by a marker that says
// how much was elided, so the pane can be honest about it rather than showing a
// clipped object as if it were whole.

export interface TruncationMarker {
  _truncated: true;
  bytes: number;
  preview: string;
}

const PREVIEW_CHARS = 200;

/** Return the payload as-is, or a marker if serializing it exceeds `maxBytes`. */
export function truncatePayload(value: unknown, maxBytes: number): unknown {
  if (value === undefined) return undefined;

  let json: string;
  try {
    json = JSON.stringify(value) ?? 'null';
  } catch {
    // Circular or otherwise unserializable — recording must not throw (FR-004).
    return { _truncated: true, bytes: 0, preview: '<unserializable>' } satisfies TruncationMarker;
  }

  // Bytes, not characters: a string of multi-byte codepoints is far larger on
  // disk than its length suggests.
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= maxBytes) return value;

  return { _truncated: true, bytes, preview: json.slice(0, PREVIEW_CHARS) } satisfies TruncationMarker;
}
