import React, { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import SourceCard from "../components/SourceCard.jsx";
import OutputCard from "../components/OutputCard.jsx";
import MappingTable from "../components/MappingTable.jsx";
import CodeView from "../components/CodeView.jsx";
import { generate } from "../api.js";
import { isMapped } from "../lib/mapping.js";

const ACCENTS = ["#7c3aed", "#0ea5e9", "#f97316"];

export default function StudioPage() {
  const { sources, output, transforms, mappings, setMappings, replaceSource, replaceOutput, error } = useOutletContext();
  const [code, setCode] = useState("");
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
      const { code } = await generate(payload);
      setCode(code);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <div>
          <h1>Transformation Studio</h1>
          <p className="hero__sub">Match source fields to your output schema. Get a clean <code>transform()</code> function you can drop into any loop.</p>
        </div>
        <div className="hero__stats">
          <div><strong>{sources.length}</strong><span>sources</span></div>
          <div><strong>{output?.keys.length || 0}</strong><span>output keys</span></div>
          <div><strong>{mappedCount}</strong><span>mapped</span></div>
        </div>
      </header>

      {(error || localError) && <div className="banner banner--error">{error || localError}</div>}

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
        <div className="generate-bar">
          <span className="generate-bar__hint">
            {mappedCount === 0
              ? "Map at least one field to generate code."
              : `${mappedCount} of ${output?.keys.length} keys mapped${mappedCount < (output?.keys.length || 0) ? " — unmapped keys default to null." : "."}`}
          </span>
          <button
            className="btn btn--primary btn--lg"
            disabled={mappedCount === 0 || generating}
            onClick={onGenerate}
          >
            {generating ? "Generating…" : "Generate code"}
          </button>
        </div>
      </section>

      <section className="code-section">
        <h2 className="section-title">Generated JavaScript</h2>
        <CodeView code={code} />
      </section>

      <footer className="foot">Sources → Mapping → Code · runs locally · {new Date().getFullYear()}</footer>
    </div>
  );
}
