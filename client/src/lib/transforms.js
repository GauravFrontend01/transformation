// Mirror of the server's transform functions — used ONLY to compute live previews
// in the picker UI. Keep these in sync with server/index.js TRANSFORM_LIBRARY.fn.
// If an id is missing here, the picker falls back to the static example.
export const PREVIEW_FNS = {
  identity: (v) => v,
  toUpperCase: (v) => (v == null ? v : String(v).toUpperCase()),
  toLowerCase: (v) => (v == null ? v : String(v).toLowerCase()),
  trim: (v) => (v == null ? v : String(v).trim()),
  toNumber: (v) => (v == null || v === "" ? null : Number(v)),
  toString: (v) => (v == null ? v : String(v)),
  toBoolean: (v) => v === true || v === "true" || v === 1 || v === "1",
  centsToDollars: (v) => (v == null || v === "" ? null : Number(v) / 100),
  isoDate: (v) => (v == null || v === "" ? null : new Date(v).toISOString()),
  toDateOnly: (v) => (v == null || v === "" ? null : new Date(v).toISOString().slice(0, 10)),
};

// Try to compute a live preview using the real sample value.
// Falls back to the transform's static example when no sample is connected.
export function preview(transformId, value, example) {
  const fn = PREVIEW_FNS[transformId];
  const hasRealValue = value !== undefined && value !== null && value !== "";
  if (!hasRealValue || !fn) {
    return { in: example?.in ?? value, out: example?.out ?? value, isExample: true, errored: false };
  }
  try {
    return { in: value, out: fn(value), isExample: false, errored: false };
  } catch {
    return { in: value, out: "—", isExample: false, errored: true };
  }
}

// Render any JS value compactly inside a code chip.
export function displayValue(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (v === "") return '""';
  if (typeof v === "string") {
    const trimmedish = v.length > 28 ? v.slice(0, 27) + "…" : v;
    return JSON.stringify(trimmedish);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NaN";
  return String(v);
}
