import React, { useRef } from "react";

export default function OutputCard({ output, onReplace }) {
  const inputRef = useRef(null);
  const keys = output?.keys || [];

  return (
    <div className="card card--output">
      <div className="card__header">
        <div>
          <div className="card__eyebrow">Output schema</div>
          <div className="card__title">{output?.label || "Output"}</div>
          <div className="card__subtitle">
            {output?.filename} · {keys.length} target key{keys.length === 1 ? "" : "s"}
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
          {keys.map((k) => (
            <div key={k.name} className="field-row">
              <span className="field-row__name">{k.name}</span>
              <span className={`pill pill--${k.type}`}>{k.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
