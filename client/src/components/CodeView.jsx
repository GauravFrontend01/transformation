import React, { useEffect, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-json.js";
import "prismjs/themes/prism-tomorrow.css";

const MIME = {
  javascript: "text/javascript",
  json: "application/json",
};

export default function CodeView({ code, filename = "transform.js", language = "javascript" }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const extension = filename.includes(".") ? filename.split(".").pop() : language;

  useEffect(() => {
    if (ref.current) Prism.highlightElement(ref.current);
  }, [code, language]);

  if (!code) {
    return (
      <div className="code code--empty">
        <p>Pick at least one mapping, then click <strong>Generate code</strong>.</p>
      </div>
    );
  }

  function download() {
    const blob = new Blob([code], { type: MIME[language] || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }

  return (
    <div className="code">
      <div className="code__toolbar">
        <span className="code__filename">{filename}</span>
        <div className="code__actions">
          <button className="btn btn--ghost" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
          <button className="btn btn--primary" onClick={download}>Download .{extension}</button>
        </div>
      </div>
      <pre className="code__pre"><code ref={ref} className={`language-${language}`}>{code}</code></pre>
    </div>
  );
}
