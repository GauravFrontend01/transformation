import React from "react";
import { normalize, removeInput, updateInput, setSeparator, appendEmptyInput } from "../lib/mapping.js";

export default function MappingTable({ sources, outputKeys, mappings, transforms, onChange, onAutoMatch, onClear }) {
  function patchInput(outputKey, index, patch) {
    let next = updateInput(mappings, outputKey, index, patch);
    // Switching the source resets the field (it doesn't exist on the new source).
    if (patch.sourceId !== undefined) {
      next = updateInput(next, outputKey, index, { field: "" });
    }
    onChange(next);
  }

  function addRow(outputKey) {
    onChange(appendEmptyInput(mappings, outputKey));
  }

  function removeRow(outputKey, idx) {
    const m = normalize(mappings[outputKey]);
    if (!m) return;
    const inp = m.inputs[idx];
    if (!inp) return;
    onChange(removeInput(mappings, outputKey, inp.sourceId, inp.field));
  }

  function changeSeparator(outputKey, separator) {
    onChange(setSeparator(mappings, outputKey, separator));
  }

  return (
    <div className="mapping">
      <div className="mapping__toolbar">
        <div>
          <h2 className="section-title">Field mappings</h2>
          <p className="mapping__hint">One or more source fields per output key. Multiple inputs are joined with the separator.</p>
        </div>
        <div className="mapping__actions">
          <button className="btn btn--ghost" onClick={onAutoMatch}>Auto-match by name</button>
          <button className="btn btn--ghost" onClick={onClear}>Clear</button>
        </div>
      </div>

      <div className="mapping__group-list">
        {outputKeys.map((k) => {
          const m = normalize(mappings[k.name]);
          const inputs = m?.inputs || [];
          const showSeparator = inputs.filter((i) => i.sourceId && i.field).length >= 2;

          return (
            <div key={k.name} className={`mapping__group ${inputs.length ? "is-mapped" : ""}`}>
              <div className="mapping__group-key">
                <span className="mapping__key-name">{k.name}</span>
                <span className={`pill pill--${k.type}`}>{k.type}</span>
              </div>

              <div className="mapping__group-inputs">
                {inputs.length === 0 ? (
                  <InputRow
                    sources={sources}
                    transforms={transforms}
                    input={{ sourceId: "", field: "", transform: "identity" }}
                    onPatch={(patch) => {
                      // Implicitly create the first input row on first interaction.
                      const seeded = appendEmptyInput(mappings, k.name);
                      const next = updateInput(seeded, k.name, 0, patch);
                      onChange(next);
                    }}
                    onRemove={null}
                  />
                ) : (
                  inputs.map((inp, idx) => (
                    <InputRow
                      key={idx}
                      sources={sources}
                      transforms={transforms}
                      input={inp}
                      onPatch={(patch) => patchInput(k.name, idx, patch)}
                      onRemove={() => removeRow(k.name, idx)}
                    />
                  ))
                )}

                <div className="mapping__group-footer">
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={() => addRow(k.name)}
                    disabled={inputs.length > 0 && inputs.some((i) => !i.sourceId || !i.field)}
                    title={inputs.length > 0 && inputs.some((i) => !i.sourceId || !i.field) ? "Finish the current row first" : ""}
                  >
                    + Add input
                  </button>

                  {showSeparator && (
                    <label className="mapping__sep">
                      <span>Join with</span>
                      <input
                        className="select select--inline"
                        value={m.separator ?? " "}
                        placeholder=" "
                        onChange={(e) => changeSeparator(k.name, e.target.value)}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InputRow({ sources, transforms, input, onPatch, onRemove }) {
  const src = sources.find((s) => s.id === input.sourceId);
  const fields = src?.fields || [];
  return (
    <div className="mapping__input-row">
      <select className="select" value={input.sourceId || ""} onChange={(e) => onPatch({ sourceId: e.target.value })}>
        <option value="">— source —</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>{s.label} ({s.id})</option>
        ))}
      </select>

      <select className="select" value={input.field || ""} disabled={!input.sourceId} onChange={(e) => onPatch({ field: e.target.value })}>
        <option value="">— field —</option>
        {fields.map((f) => (
          <option key={f.name} value={f.name}>{f.name}  ·  {f.type}</option>
        ))}
      </select>

      <select className="select" value={input.transform || "identity"} disabled={!input.field} onChange={(e) => onPatch({ transform: e.target.value })}>
        {transforms.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>

      {onRemove ? (
        <button className="btn btn--ghost btn--icon" onClick={onRemove} title="Remove this input">×</button>
      ) : (
        <span className="btn--icon-placeholder" />
      )}
    </div>
  );
}
