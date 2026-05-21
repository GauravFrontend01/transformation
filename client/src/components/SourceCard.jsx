import React, { useRef } from "react";

export default function SourceCard({ source, onReplace, accent }) {
  const inputRef = useRef(null);

  if (!source) {
    return (
      <div className="card card--empty">
        <div className="card__title">Empty source</div>
      </div>
    );
  }

  const fields = source.fields || [];
  const recordCount = source.recordCount ?? 0;

  return (
    <div className="card" style={{ "--accent": accent }}>
      <div className="card__header">
        <div>
          <div className="card__eyebrow">Source · <code>{source.id}</code></div>
          <div className="card__title">{source.label}</div>
          <div className="card__subtitle">
            {source.filename} · {recordCount} record{recordCount === 1 ? "" : "s"} · {fields.length} field{fields.length === 1 ? "" : "s"}
          </div>
        </div>
        <button className="btn btn--ghost" onClick={() => inputRef.current?.click()}>Replace</button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.csv,.tsv"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onReplace(file);
            e.target.value = "";
          }}
        />
      </div>
      <div className="card__body">
        <div className="field-list">
          {fields.map((f) => (
            <div key={f.name} className="field-row">
              <span className="field-row__name">{f.name}</span>
              <span className={`pill pill--${f.type}`}>{f.type}</span>
              <span className="field-row__sample" title={String(f.sample)}>
                {f.sample === null || f.sample === undefined || f.sample === "" ? "—" : String(f.sample)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
