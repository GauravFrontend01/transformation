// Normalize a mapping to the canonical multi-input shape.
// Accepts the legacy single-input shape too so older state survives a hot-reload.
export function normalize(m) {
  if (!m) return null;
  if (Array.isArray(m.inputs)) return m;
  if (m.sourceId && m.field) {
    return {
      inputs: [{ sourceId: m.sourceId, field: m.field, transform: m.transform || "identity" }],
      separator: " ",
    };
  }
  return null;
}

export function inputCount(m) {
  const n = normalize(m);
  if (!n) return 0;
  return n.inputs.filter((i) => i.sourceId && i.field).length;
}

export function isMapped(m) {
  return inputCount(m) > 0;
}

// Add an input to an output key — no-op if exact (sourceId, field) is already there.
export function addInput(mappings, outputKey, input) {
  const cur = normalize(mappings[outputKey]) || { inputs: [], separator: " " };
  if (cur.inputs.some((i) => i.sourceId === input.sourceId && i.field === input.field)) {
    return mappings;
  }
  return {
    ...mappings,
    [outputKey]: { ...cur, inputs: [...cur.inputs, { transform: "identity", ...input }] },
  };
}

// Remove one specific input. Drops the key entirely if no inputs remain.
export function removeInput(mappings, outputKey, sourceId, field) {
  const cur = normalize(mappings[outputKey]);
  if (!cur) return mappings;
  const remaining = cur.inputs.filter((i) => !(i.sourceId === sourceId && i.field === field));
  const next = { ...mappings };
  if (remaining.length === 0) delete next[outputKey];
  else next[outputKey] = { ...cur, inputs: remaining };
  return next;
}

export function updateInput(mappings, outputKey, index, patch) {
  const cur = normalize(mappings[outputKey]);
  if (!cur) return mappings;
  const inputs = cur.inputs.map((inp, i) => (i === index ? { ...inp, ...patch } : inp));
  // If a row was reset to no source, drop it.
  const cleaned = inputs.filter((i, idx) => idx !== index || (i.sourceId && i.field) || (!i.sourceId && !i.field && i.transform === "identity"));
  return { ...mappings, [outputKey]: { ...cur, inputs } };
}

export function setSeparator(mappings, outputKey, separator) {
  const cur = normalize(mappings[outputKey]);
  if (!cur) return mappings;
  return { ...mappings, [outputKey]: { ...cur, separator } };
}

// Append an empty input row for the UI to fill in.
export function appendEmptyInput(mappings, outputKey) {
  const cur = normalize(mappings[outputKey]) || { inputs: [], separator: " " };
  return {
    ...mappings,
    [outputKey]: { ...cur, inputs: [...cur.inputs, { sourceId: "", field: "", transform: "identity" }] },
  };
}

// All connection threads, one entry per (outputKey, input). Used by the drag UI.
export function listConnections(mappings, outputKeys) {
  const out = [];
  for (const k of outputKeys || []) {
    const m = normalize(mappings[k.name]);
    if (!m) continue;
    for (const inp of m.inputs) {
      if (!inp.sourceId || !inp.field) continue;
      out.push({
        outputKey: k.name,
        sourceId: inp.sourceId,
        field: inp.field,
        transform: inp.transform,
      });
    }
  }
  return out;
}
