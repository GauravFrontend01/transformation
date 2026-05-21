import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { preview, displayValue } from "../lib/transforms.js";

/**
 * A designed-not-native dropdown for selecting a transform.
 * Each option shows its description and a live preview using `sampleValue`
 * (the current value of the connected source field), falling back to a
 * static example when no real value is available.
 */
export default function TransformPicker({ value, onChange, sampleValue, options }) {
  const [open, setOpen] = useState(false);
  const [popPos, setPopPos] = useState(null); // { left, top, width, alignRight }
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  const current = options.find((o) => o.id === value) || options[0];

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (popRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Compute popover position so it never gets clipped by the row/card.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const POP_W = 340;
      const POP_MAX_H = 380;
      const margin = 8;
      const spaceBelow = window.innerHeight - r.bottom;
      const placeAbove = spaceBelow < POP_MAX_H + margin && r.top > spaceBelow;
      const top = placeAbove ? r.top - POP_MAX_H - margin : r.bottom + margin;
      let left = r.left;
      if (left + POP_W > window.innerWidth - 12) left = window.innerWidth - POP_W - 12;
      if (left < 12) left = 12;
      setPopPos({ left, top, width: POP_W, maxHeight: POP_MAX_H, placeAbove });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function pick(id) {
    onChange(id);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={"tpick__trigger" + (open ? " is-open" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="tpick__trigger-label">{current?.label || "transform"}</span>
        <span className="tpick__caret" aria-hidden>▾</span>
      </button>

      {open && popPos && (
        <div
          ref={popRef}
          className="tpick__pop"
          role="listbox"
          style={{
            position: "fixed",
            left: popPos.left,
            top: popPos.top,
            width: popPos.width,
            maxHeight: popPos.maxHeight,
          }}
        >
          <div className="tpick__pop-head">
            <span className="tpick__pop-title">Transform</span>
            <span className="tpick__pop-hint">
              {sampleValue == null || sampleValue === ""
                ? "showing static examples"
                : "live · using this field's first value"}
            </span>
          </div>

          <div className="tpick__pop-list">
            {options.map((opt) => {
              const p = preview(opt.id, sampleValue, opt.example);
              const selected = opt.id === value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={"tpick__opt" + (selected ? " is-selected" : "")}
                  onClick={() => pick(opt.id)}
                  role="option"
                  aria-selected={selected}
                >
                  <div className="tpick__opt-head">
                    <span className="tpick__opt-label">{opt.label}</span>
                    <span className="tpick__opt-tags">
                      {selected && <span className="tpick__opt-tag tpick__opt-tag--sel">selected</span>}
                      {p.isExample && <span className="tpick__opt-tag">example</span>}
                    </span>
                  </div>
                  {opt.description && <div className="tpick__opt-desc">{opt.description}</div>}
                  <div className="tpick__opt-preview">
                    <code className="tpick__chip tpick__chip--in" title={String(p.in)}>{displayValue(p.in)}</code>
                    <span className="tpick__arrow">→</span>
                    <code className={"tpick__chip tpick__chip--out" + (p.errored ? " is-error" : "")} title={String(p.out)}>
                      {displayValue(p.out)}
                    </code>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
