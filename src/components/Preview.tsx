import { useRef, useState } from "react";
import type { CloneOutput } from "../engine/types";
import { percent } from "../engine/util";
import type { RunState } from "../model";

function downloadClone(output: CloneOutput): void {
  const filename = output.filename ?? "artifact.clone";
  let url: string;
  let revoke = false;
  if (output.dataUrl) {
    url = output.dataUrl;
  } else {
    const payload: BlobPart = output.bytes
      ? (output.bytes.slice().buffer as ArrayBuffer)
      : (output.text ?? "");
    const blob = new Blob([payload], {
      type: output.mime ?? "application/octet-stream",
    });
    url = URL.createObjectURL(blob);
    revoke = true;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 600);
}

function ImageCompare({ run }: { run: RunState }) {
  const [split, setSplit] = useState(52);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const image = run.artifact.image;

  const move = (clientX: number) => {
    const element = frame.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setSplit(Math.min(98, Math.max(2, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div
      className="compare"
      ref={frame}
      style={image ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        move(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging) move(event.clientX);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      {run.artifact.previewUrl && (
        <img
          className="compare-image"
          src={run.artifact.previewUrl}
          alt="Original artifact"
          draggable={false}
        />
      )}
      {run.output.dataUrl && (
        <div
          className="compare-clone"
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        >
          <img
            className="compare-image"
            src={run.output.dataUrl}
            alt="Reconstructed clone"
            draggable={false}
          />
        </div>
      )}
      <span className="compare-label left">TARGET</span>
      <span className="compare-label right">CLONE</span>
      <div className="compare-divider" style={{ left: `${split}%` }}>
        <span />
      </div>
      <span className="compare-hint">DRAG THE LINE</span>
    </div>
  );
}

function TextCompare({ run }: { run: RunState }) {
  const original = run.artifact.text?.sample ?? "";
  const clone = run.output.text ?? "";
  return (
    <>
      <div className="text-compare">
        <div className="text-pane">
          <header>
            <span>ORIGINAL</span>
            <em>{run.artifact.text?.words.toLocaleString()} words</em>
          </header>
          <pre>{original}</pre>
        </div>
        <div className="text-pane clone">
          <header>
            <span>STYLE RECONSTRUCTION</span>
            <em>{clone.length.toLocaleString()} chars</em>
          </header>
          <pre>{clone}</pre>
        </div>
      </div>
      <p className="pane-note">
        The clone is sampled from the artifact&apos;s own token transitions. It keeps
        cadence and vocabulary; it does not keep the original wording.
      </p>
    </>
  );
}

function EntropyChart({
  original,
  clone,
}: {
  original: number[];
  clone: number[];
}) {
  const count = Math.min(32, Math.max(original.length, clone.length));
  const width = 320;
  const height = 72;
  const pad = 4;
  const points = (values: number[]) => {
    const usable = values.slice(0, count);
    if (usable.length < 2) return "";
    return usable
      .map((value, index) => {
        const x = pad + (index / (usable.length - 1)) * (width - pad * 2);
        const y = height - pad - (Math.min(8, value) / 8) * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };
  return (
    <div className="entropy-chart">
      <div className="chart-head">
        <span>ENTROPY / 4 KB BLOCKS</span>
        <span className="chart-legend">
          <i className="dot original" /> source
          <i className="dot clone" /> clone
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0, 2, 4, 6, 8].map((tick) => {
          const y = height - 4 - (tick / 8) * (height - 8);
          return (
            <line
              key={tick}
              x1="0"
              x2={width}
              y1={y}
              y2={y}
              className="chart-grid"
            />
          );
        })}
        <polyline points={points(original)} className="line-original" />
        <polyline points={points(clone)} className="line-clone" />
      </svg>
      <div className="chart-axis">
        <span>0 BITS</span>
        <span>8 BITS</span>
      </div>
    </div>
  );
}

function hexDump(bytes: Uint8Array, limit: number): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, limit); offset += 16) {
    const chunk = [...bytes.subarray(offset, offset + 16)];
    const hex = chunk
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47, " ");
    const ascii = chunk
      .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : "."))
      .join("");
    lines.push(`${offset.toString(16).padStart(4, "0")}  ${hex}  ${ascii}`);
  }
  return lines.join("\n");
}

function BinaryCompare({ run }: { run: RunState }) {
  const originalBytes = run.artifact.binary?.sample ?? new Uint8Array();
  const cloneBytes = run.output.bytes ?? new Uint8Array();
  const profile = run.output.binaryProfile;
  const originalEntropy = run.artifact.binary?.entropyBlocks ?? [];
  return (
    <>
      <div className="binary-metrics">
        <EntropyChart
          original={originalEntropy}
          clone={profile?.entropy ?? []}
        />
        <div className="binary-summary">
          <div>
            <span>ORIGINAL</span>
            <b>{originalBytes.length.toLocaleString()} B</b>
          </div>
          <div>
            <span>CLONE</span>
            <b>{cloneBytes.length.toLocaleString()} B</b>
          </div>
          <div>
            <span>HEADER</span>
            <b>{run.artifact.binary?.headerInfo[0]?.[1] ?? "UNPARSED"}</b>
          </div>
          <div>
            <span>SECTIONS</span>
            <b>{run.artifact.binary?.sections.length ?? 0}</b>
          </div>
        </div>
      </div>
      <div className="hex-compare">
        <div className="hex-pane">
          <header>SOURCE BYTES</header>
          <pre>{hexDump(originalBytes, 224)}</pre>
        </div>
        <div className="hex-pane clone">
          <header>CLONE BYTES</header>
          <pre>{hexDump(cloneBytes, 224)}</pre>
        </div>
      </div>
      <p className="pane-note">
        Rebuilt from context transitions, histogram mass, and entropy shape. Headers
        are copied; payload bytes are new.
      </p>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  image: "SPLIT VIEW",
  text: "STYLE REPLICA",
  binary: "STATISTICAL REPLICA",
};

export function Preview({ run }: { run: RunState }) {
  const kind = run.artifact.kind;
  return (
    <section className="panel preview-panel">
      <div className="panel-head">
        <div className="ph-title">
          TARGET <span>/</span> RECONSTRUCTION <em>{KIND_LABEL[kind]}</em>
        </div>
        <div className="ph-actions">
          <span className="score-pill">{percent(run.output.score)}</span>
          <button
            className="download"
            type="button"
            onClick={() => downloadClone(run.output)}
          >
            DOWNLOAD CLONE ↗
          </button>
        </div>
      </div>
      {kind === "image" && <ImageCompare run={run} />}
      {kind === "text" && <TextCompare run={run} />}
      {kind === "binary" && <BinaryCompare run={run} />}
      <div className="fact-row">
        {run.output.facts.map((fact) => (
          <div className="fact" key={fact.label}>
            <span>{fact.label}</span>
            <b>{fact.value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
