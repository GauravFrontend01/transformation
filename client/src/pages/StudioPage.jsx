import React, { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import SourceCard from "../components/SourceCard.jsx";
import OutputCard from "../components/OutputCard.jsx";
import MappingTable from "../components/MappingTable.jsx";
import CodeView from "../components/CodeView.jsx";
import { generate } from "../api.js";
import { isMapped } from "../lib/mapping.js";

const ACCENTS = ["#1d3557", "#7a5530", "#3f6b3a"];

export default function StudioPage() {
  const { sources, output, transforms, mappings, setMappings, replaceSource, replaceOutput, error } = useOutletContext();
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [localError, setLocalError] = useState("");

  const mappedCount = useMemo(
    () => Object.values(mappings).filter(isMapped).length,
    [mappings]
  );

  function autoMatch() {
    if (!output) return;
    const next = { ...mappings };
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const key of output.keys) {
      if (isMapped(next[key.name])) continue;
      const target = norm(key.name);
      let hit = null;
      for (const s of sources) {
        const f = s.fields.find((fld) => norm(fld.name) === target);
        if (f) { hit = { sourceId: s.id, field: f.name, transform: "identity" }; break; }
      }
      if (!hit) {
        for (const s of sources) {
          const f = s.fields.find((fld) => norm(fld.name).includes(target) || target.includes(norm(fld.name)));
          if (f) { hit = { sourceId: s.id, field: f.name, transform: "identity" }; break; }
        }
      }
      if (hit) next[key.name] = { inputs: [hit], separator: " " };
    }
    setMappings(next);
  }

  async function onGenerate() {
    setLocalError("");
    setGenerating(true);
    try {
      const payload = {
        sources: sources.map((s) => ({ id: s.id, label: s.label })),
        outputKeys: output.keys,
        mappings,
      };
      const res = await generate(payload);
      setCode(res.code);
      setPreview(res.preview || null);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="match">
      <header className="match__hero">
        <p className="match__eyebrow">Studio · table view</p>
        <h1 className="match__title">
          Transformation <span className="match__title-em">Studio.</span>
        </h1>
        <p className="match__sub">
          Match source fields to your output schema. Get a clean <code>transform()</code> function you can drop into any loop.
        </p>
      </header>

      <div className="studio__stats">
        <div className="match__count">
          <strong>{sources.length}</strong> <span>source{sources.length === 1 ? "" : "s"}</span>
        </div>
        <div className="match__count">
          <strong>{output?.keys.length || 0}</strong> <span>output keys</span>
        </div>
        <div className="match__count">
          <strong>{mappedCount}</strong> <span>mapped</span>
        </div>
      </div>

      {(error || localError) && <div className="match__banner">{error || localError}</div>}

      <section className="panels">
        <div className="panels__sources">
          {sources.map((s, i) => (
            <SourceCard key={s.id} source={s} accent={ACCENTS[i % ACCENTS.length]} onReplace={(f) => replaceSource(i, f)} />
          ))}
        </div>
        <div className="panels__output">
          <OutputCard output={output} onReplace={replaceOutput} />
        </div>
      </section>

      <section className="mapping-section">
        <MappingTable
          sources={sources}
          outputKeys={output?.keys || []}
          mappings={mappings}
          transforms={transforms}
          onChange={setMappings}
          onAutoMatch={autoMatch}
          onClear={() => setMappings({})}
        />
        <div className="match__generate match__generate--inline">
          <button
            className="lbtn lbtn--primary"
            disabled={mappedCount === 0 || generating}
            onClick={onGenerate}
          >
            {generating ? "Generating…" : "Generate code"}
          </button>
          <span className="match__hint">
            {mappedCount === 0
              ? "Map at least one field to generate code."
              : `${mappedCount} of ${output?.keys.length} keys mapped${mappedCount < (output?.keys.length || 0) ? " — unmapped keys default to null." : "."}`}
          </span>
        </div>
      </section>

      {code && (
        <section className="match__code">
          <p className="match__eyebrow" style={{ marginBottom: 12 }}>Generated JavaScript</p>
          <CodeView code={code} filename="transform.js" language="javascript" />
        </section>
      )}

      {preview && code && (
        <section className="match__output">
          <div className="match__output-header">
            <div>
              <span className="match__output-title">Sample output</span>
              {preview.records && (
                <span className="match__output-sub">
                  running <code>transform()</code> over the first {preview.records.length} record{preview.records.length === 1 ? "" : "s"}
                  {preview.total > preview.records.length ? ` of ${preview.total}` : ""}
                </span>
              )}
            </div>
            {preview.records && (
              <span className="match__output-meta">
                {preview.records.filter((r) => r.ok).length}/{preview.records.length} ok
              </span>
            )}
          </div>
          {preview.error ? (
            <div className="match__banner">Could not run transform: {preview.error}</div>
          ) : (
            <CodeView
              code={JSON.stringify(preview.records.map((r) => (r.ok ? r.value : { __error: r.error })), null, 2)}
              filename="sample-output.json"
              language="json"
            />
          )}
        </section>
      )}

      <footer className="match__foot">Sources → Mapping → Code · runs locally · {new Date().getFullYear()}</footer>
    </div>
  );
}
