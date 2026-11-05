// JSON for values holding Maps and Sets (worker task inputs, docs/COMPUTE.md): tagged on the
// way out, rebuilt on the way in. Undefined fields are left out, as JSON.stringify does. Pure.

export function encodeWire(v: unknown): unknown {
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [encodeWire(k), encodeWire(x)]) };
  if (v instanceof Set) return { $set: [...v].map(encodeWire) };
  if (Array.isArray(v)) return v.map(encodeWire);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = encodeWire(x);
    return out;
  }
  return v;
}

export function decodeWire<T>(v: unknown): T {
  return decode(v) as T;
}

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === "$map")
      return new Map((o.$map as [unknown, unknown][]).map(([k, x]) => [decode(k), decode(x)]));
    if (keys.length === 1 && keys[0] === "$set") return new Set((o.$set as unknown[]).map(decode));
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = decode(o[k]);
    return out;
  }
  return v;
}
