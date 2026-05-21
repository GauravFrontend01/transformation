import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import CodeView from "../components/CodeView.jsx";
import TransformPicker from "../components/TransformPicker.jsx";
import { generate } from "../api.js";
import {
  normalize,
  addInput,
  removeInput,
  listConnections,
  setSeparator as setSep,
} from "../lib/mapping.js";

function sampleFor(sources, sourceId, field) {
  const s = sources.find((x) => x.id === sourceId);
  if (!s) return undefined;
  const f = s.fields.find((x) => x.name === field);
  return f?.sample;
}

function bezier(a, b) {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x},${a.y} C ${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

const SOURCE_INK = { 0: "#1d3557", 1: "#7a5530", 2: "#3f6b3a" };

export default function MatchPage() {
  const { sources, output, transforms, mappings, setMappings, replaceSource, replaceOutput, error } = useOutletContext();

  const containerRef = useRef(null);
  const dotRefs = useRef(new Map());
  const [drag, setDrag] = useState(null);
  const [positions, setPositions] = useState({});
  const [hoverConn, setHoverConn] = useState(null);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [localError, setLocalError] = useState("");

  const connections = useMemo(
    () => (output ? listConnections(mappings, output.keys) : []),
    [mappings, output]
  );

  useLayoutEffect(() => {
    function recompute() {
      const node = containerRef.current;
      if (!node) return;
      const base = node.getBoundingClientRect();
      const next = {};
      for (const [key, el] of dotRefs.current.entries()) {
        if (!el || !el.isConnected) continue;
        const r = el.getBoundingClientRect();
        next[key] = {
          x: r.left + r.width / 2 - base.left,
          y: r.top + r.height / 2 - base.top,
        };
      }
      setPositions(next);
    }
    recompute();
    const obs = new ResizeObserver(recompute);
    if (containerRef.current) obs.observe(containerRef.current);
    const t = setTimeout(recompute, 50);
    window.addEventListener("resize", recompute);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", recompute);
      clearTimeout(t);
    };
  }, [sources, output, mappings]);

  useEffect(() => {
    if (!drag) return;

    function findDropTarget(clientX, clientY) {
      const stack = document.elementsFromPoint(clientX, clientY) || [];
      for (const el of stack) {
        const hit = el.closest?.("[data-dot-key],[data-row-key]");
        if (!hit) continue;
        const side = hit.getAttribute("data-dot-side") || hit.getAttribute("data-row-side");
        const key = hit.getAttribute("data-dot-key") || hit.getAttribute("data-row-key");
        if (side && key && side !== drag.from.side) return { side, key };
      }
      return null;
    }

    function onMove(e) {
      const node = containerRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      const dropTarget = findDropTarget(e.clientX, e.clientY);
      setDrag((prev) => (prev ? { ...prev, cursor, dropTarget } : prev));
    }
    function onUp(e) {
      const target = findDropTarget(e.clientX, e.clientY);
      if (target) connect(drag.from, target);
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag]);

  function connect(a, b) {
    const src = a.side === "source" ? a : b;
    const out = a.side === "output" ? a : b;
    const sep = src.key.indexOf("|");
    const sourceId = src.key.slice(0, sep);
    const field = src.key.slice(sep + 1);
    setMappings((m) => addInput(m, out.key, { sourceId, field, transform: "identity" }));
  }

  function cut(outputKey, sourceId, field) {
    setMappings((m) => removeInput(m, outputKey, sourceId, field));
  }

  function setInputTransform(outputKey, sourceId, field, transform) {
    setMappings((m) => {
      const cur = normalize(m[outputKey]);
      if (!cur) return m;
      return {
        ...m,
        [outputKey]: {
          ...cur,
          inputs: cur.inputs.map((i) => (i.sourceId === sourceId && i.field === field ? { ...i, transform } : i)),
        },
      };
    });
  }

  function changeSeparator(outputKey, separator) {
    setMappings((m) => setSep(m, outputKey, separator));
  }

  function onDotPointerDown(side, key, e) {
    e.preventDefault();
    const r = containerRef.current.getBoundingClientRect();
    setDrag({ from: { side, key }, cursor: { x: e.clientX - r.left, y: e.clientY - r.top } });
  }

  function autoMatch() {
    if (!output) return;
    const next = { ...mappings };
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const key of output.keys) {
      const cur = normalize(next[key.name]);
      if (cur && cur.inputs.some((i) => i.sourceId && i.field)) continue;
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
      const res = await generate({
        sources: sources.map((s) => ({ id: s.id, label: s.label })),
        outputKeys: output.keys,
        mappings,
      });
      setCode(res.code);
      setPreview(res.preview || null);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  if (!output) return null;

  const matchedKeys = output.keys.filter((k) => normalize(mappings[k.name])?.inputs.some((i) => i.sourceId && i.field)).length;

  return (
    <div className="match">
      <header className="match__hero">
        <p className="match__eyebrow">Worksheet · drag to connect</p>
        <h1 className="match__title">
          Match <span className="match__title-em">the following.</span>
        </h1>
        <p className="match__sub">
          Pull a thread from any field on the left to a key on the right. Drop more than one onto the same key
          to combine them (like <em>first_name + last_name → full_name</em>). Click a thread to cut it.
        </p>
      </header>

      {(error || localError) && <div className="match__banner">{error || localError}</div>}

      <div className="match__toolbar">
        <button className="lbtn" onClick={autoMatch}>Auto-match by name</button>
        <button className="lbtn lbtn--ghost" onClick={() => setMappings({})}>Clear all</button>
        <div className="match__legend">
          <span className="match__legend-dot match__legend-dot--src" /> source
          <span className="match__legend-dot match__legend-dot--out" /> output
        </div>
        <div className="match__count">
          <strong>{matchedKeys}</strong> <span>of {output.keys.length} matched · {connections.length} thread{connections.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="match__canvas" ref={containerRef}>
        <svg className={"match__lines" + (drag ? " is-dragging" : "")} aria-hidden="true">
          {connections.map((c) => {
            const fromKey = `s|${c.sourceId}|${c.field}`;
            const toKey = `o|${c.outputKey}`;
            const a = positions[fromKey];
            const b = positions[toKey];
            if (!a || !b) return null;
            const d = bezier(a, b);
            const cid = `${c.outputKey}|${c.sourceId}|${c.field}`;
            const isHover = hoverConn === cid;
            const ink = SOURCE_INK[sources.findIndex((s) => s.id === c.sourceId) % 3] || "#1d3557";
            return (
              <g key={cid}>
                <path
                  d={d}
                  className="match__line-hit"
                  onMouseEnter={() => setHoverConn(cid)}
                  onMouseLeave={() => setHoverConn(null)}
                  onClick={() => cut(c.outputKey, c.sourceId, c.field)}
                />
                <path d={d} className={"match__line" + (isHover ? " is-hover" : "")} stroke={ink} />
                {isHover && (
                  <g style={{ pointerEvents: "none" }}>
                    <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="11" fill="#fffdf8" stroke={ink} strokeWidth="1.4" />
                    <path
                      d={`M ${(a.x + b.x) / 2 - 4} ${(a.y + b.y) / 2 - 4} L ${(a.x + b.x) / 2 + 4} ${(a.y + b.y) / 2 + 4} M ${(a.x + b.x) / 2 + 4} ${(a.y + b.y) / 2 - 4} L ${(a.x + b.x) / 2 - 4} ${(a.y + b.y) / 2 + 4}`}
                      stroke={ink}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </g>
                )}
              </g>
            );
          })}
          {drag && (() => {
            const fromKey = drag.from.side === "source" ? `s|${drag.from.key}` : `o|${drag.from.key}`;
            const a = positions[fromKey];
            if (!a) return null;
            // Snap the endpoint to the target dot if we're over a valid row.
            let end = drag.cursor;
            let locked = false;
            if (drag.dropTarget) {
              const toKey = drag.dropTarget.side === "source" ? `s|${drag.dropTarget.key}` : `o|${drag.dropTarget.key}`;
              if (positions[toKey]) {
                end = positions[toKey];
                locked = true;
              }
            }
            const d = bezier(a, end);
            return <path d={d} className={"match__line match__line--ghost" + (locked ? " is-locked" : "")} />;
          })()}
        </svg>

        <div className="match__cols">
          <div className="match__col">
            {sources.map((s, idx) => (
              <SourceGroup
                key={s.id}
                source={s}
                ink={SOURCE_INK[idx % 3]}
                dotRefs={dotRefs}
                onDotDown={onDotPointerDown}
                onReplace={(f) => replaceSource(idx, f)}
                connectedFields={connections.filter((c) => c.sourceId === s.id).map((c) => c.field)}
                dropTarget={drag?.dropTarget?.side === "source" ? drag.dropTarget.key : null}
              />
            ))}
          </div>

          <div className="match__col">
            <OutputGroup
              output={output}
              transforms={transforms}
              mappings={mappings}
              sources={sources}
              setInputTransform={setInputTransform}
              changeSeparator={changeSeparator}
              cut={cut}
              dotRefs={dotRefs}
              onDotDown={onDotPointerDown}
              onReplace={replaceOutput}
              dropTarget={drag?.dropTarget?.side === "output" ? drag.dropTarget.key : null}
            />
          </div>
        </div>
      </div>

      <div className="match__generate">
        <button className="lbtn lbtn--primary" disabled={connections.length === 0 || generating} onClick={onGenerate}>
          {generating ? "Generating…" : "Generate code →"}
        </button>
        <span className="match__hint">
          {connections.length === 0
            ? "Draw at least one thread to generate."
            : `${connections.length} thread${connections.length === 1 ? "" : "s"} drawn across ${matchedKeys} output key${matchedKeys === 1 ? "" : "s"}.`}
        </span>
      </div>

      {code && (
        <div className="match__code">
          <CodeView code={code} filename="transform.js" language="javascript" />
        </div>
      )}

      {preview && (
        <PreviewPanel preview={preview} />
      )}

      <footer className="match__foot">An honest little worksheet.</footer>
    </div>
  );
}

function PreviewPanel({ preview }) {
  if (preview.error) {
    return (
      <div className="match__output">
        <div className="match__output-header">
          <span className="match__output-title">Sample output</span>
          <span className="match__output-meta match__output-meta--error">couldn't run · {preview.error}</span>
        </div>
      </div>
    );
  }
  const records = preview.records || [];
  if (records.length === 0) {
    return (
      <div className="match__output">
        <div className="match__output-header">
          <span className="match__output-title">Sample output</span>
          <span className="match__output-meta">no source records available to preview</span>
        </div>
      </div>
    );
  }

  // Show the successful values as a clean JSON array; surface row-level errors inline.
  const values = records.map((r) => (r.ok ? r.value : { __error: r.error }));
  const okCount = records.filter((r) => r.ok).length;
  const json = JSON.stringify(values, null, 2);

  return (
    <div className="match__output">
      <div className="match__output-header">
        <div>
          <span className="match__output-title">Sample output</span>
          <span className="match__output-sub">
            running <code>transform()</code> over the first {records.length} record{records.length === 1 ? "" : "s"}
            {preview.total > records.length ? ` of ${preview.total}` : ""}
            {okCount < records.length ? ` · ${records.length - okCount} errored` : ""}
          </span>
        </div>
        <span className="match__output-meta">{okCount}/{records.length} ok</span>
      </div>
      <CodeView code={json} filename="sample-output.json" language="json" />
    </div>
  );
}

function SourceGroup({ source, ink, dotRefs, onDotDown, onReplace, connectedFields, dropTarget }) {
  const inputRef = useRef(null);
  const connected = new Set(connectedFields);
  return (
    <div className="match__card">
      <div className="match__card-header">
        <div>
          <div className="match__card-eyebrow" style={{ color: ink }}>Source</div>
          <div className="match__card-title">{source.label}</div>
          <div className="match__card-meta">{source.filename} · {source.recordCount} record{source.recordCount === 1 ? "" : "s"}</div>
        </div>
        <button className="lbtn lbtn--xs" onClick={() => inputRef.current?.click()}>Replace</button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.csv,.tsv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onReplace(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="match__rows">
        {source.fields.map((f) => {
          const key = `${source.id}|${f.name}`;
          const dotKey = `s|${key}`;
          const isConnected = connected.has(f.name);
          const isTarget = dropTarget === key;
          return (
            <div
              key={f.name}
              className={"match__row match__row--src" + (isConnected ? " is-on" : "") + (isTarget ? " is-target" : "")}
              data-row-side="source"
              data-row-key={key}
            >
              <span className="match__row-name">{f.name}</span>
              <span className={`match__pill match__pill--${f.type}`}>{f.type}</span>
              <span className="match__row-spacer" />
              <span
                className="match__dot match__dot--src"
                style={{ "--ink": ink }}
                data-dot-side="source"
                data-dot-key={key}
                ref={(el) => { if (el) dotRefs.current.set(dotKey, el); else dotRefs.current.delete(dotKey); }}
                onPointerDown={(e) => onDotDown("source", key, e)}
                title="Drag a thread to an output key"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OutputGroup({ output, transforms, mappings, sources, setInputTransform, changeSeparator, cut, dotRefs, onDotDown, onReplace, dropTarget }) {
  const inputRef = useRef(null);
  return (
    <div className="match__card match__card--out">
      <div className="match__card-header">
        <div>
          <div className="match__card-eyebrow">Output</div>
          <div className="match__card-title">{output.label}</div>
          <div className="match__card-meta">{output.filename} · {output.keys.length} target keys</div>
        </div>
        <button className="lbtn lbtn--xs" onClick={() => inputRef.current?.click()}>Replace</button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.csv,.tsv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onReplace(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="match__rows">
        {output.keys.map((k) => {
          const m = normalize(mappings[k.name]);
          const inputs = (m?.inputs || []).filter((i) => i.sourceId && i.field);
          const connected = inputs.length > 0;
          const dotKey = `o|${k.name}`;
          const isTarget = dropTarget === k.name;
          return (
            <div
              key={k.name}
              className={"match__row match__row--out" + (connected ? " is-on" : "") + (isTarget ? " is-target" : "")}
              data-row-side="output"
              data-row-key={k.name}
            >
              <span
                className="match__dot match__dot--out"
                data-dot-side="output"
                data-dot-key={k.name}
                ref={(el) => { if (el) dotRefs.current.set(dotKey, el); else dotRefs.current.delete(dotKey); }}
                onPointerDown={(e) => onDotDown("output", k.name, e)}
              />
              <div className="match__row-stack">
                <div className="match__row-line">
                  <span className="match__row-name">{k.name}</span>
                  <span className={`match__pill match__pill--${k.type}`}>{k.type}</span>
                  {inputs.length > 1 && <span className="match__combine-badge">combines {inputs.length}</span>}
                </div>

                {inputs.map((inp) => {
                  const src = sources.find((s) => s.id === inp.sourceId);
                  const sample = sampleFor(sources, inp.sourceId, inp.field);
                  return (
                    <div key={`${inp.sourceId}|${inp.field}`} className="match__row-meta">
                      <span className="match__row-from">
                        from <em>{src?.label || inp.sourceId}</em>.<code>{inp.field}</code>
                      </span>
                      <TransformPicker
                        value={inp.transform || "identity"}
                        onChange={(t) => setInputTransform(k.name, inp.sourceId, inp.field, t)}
                        sampleValue={sample}
                        options={transforms}
                      />
                      <button className="match__cut" onClick={() => cut(k.name, inp.sourceId, inp.field)} title="Cut thread">×</button>
                    </div>
                  );
                })}

                {inputs.length >= 2 && (
                  <label className="match__sep">
                    <span>join with</span>
                    <input
                      className="match__sep-input"
                      value={m.separator ?? " "}
                      placeholder=" "
                      onChange={(e) => changeSeparator(k.name, e.target.value)}
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
