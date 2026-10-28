import type { Artifact } from "../engine/types";
import { fmtBytes } from "../engine/util";
import type { RunState } from "../model";
import { Preview } from "./Preview";

function Pipeline({ run }: { run: RunState }) {
  const evolving = run.status === "evolving";
  const stages = [
    { label: "DISSECT", detail: run.artifact.format, state: "done" },
    {
      label: "RECALL",
      detail: run.recalled.length
        ? `${run.recalled.length} memories`
        : "cold start",
      state: "done",
    },
    {
      label: "SYNTHESIZE",
      detail: `${(run.baseline * 100).toFixed(1)}% seed`,
      state: "done",
    },
    {
      label: "EVOLVE",
      detail: `${run.attempts} trials / ${run.accepted} kept`,
      state: evolving ? "active" : "done",
    },
    {
      label: "REFLECT",
      detail: run.status === "done" ? "retained" : "pending",
      state: run.status === "done" ? "done" : "pending",
    },
  ];
  return (
    <ol className="pipeline">
      {stages.map((stage, index) => (
        <li className={`pipe-step ${stage.state}`} key={stage.label}>
          <span className="pipe-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="pipe-dot" />
          <div>
            <b>{stage.label}</b>
            <small>{stage.detail}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Evidence({
  label,
  value,
  sub,
  wide,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  wide?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={`evidence ${wide ? "wide" : ""}`}>
      <span className="e-label">{label}</span>
      <b className={`e-value ${mono ? "mono" : ""}`} title={value}>
        {value}
      </b>
      {sub && <span className="e-sub">{sub}</span>}
    </div>
  );
}

function Dissection({ artifact }: { artifact: Artifact }) {
  return (
    <section className="panel dissection">
      <div className="panel-head">
        <div className="ph-title">
          DISSECTION <em>{artifact.kind.toUpperCase()} EVIDENCE</em>
        </div>
        <span className="ph-note">LOCAL ONLY · NOTHING UPLOADED</span>
      </div>
      <div className="dissect-grid">
        <Evidence label="FORMAT" value={artifact.format} />
        <Evidence label="SIZE" value={fmtBytes(artifact.size)} />
        <Evidence label="MAGIC" value={artifact.magic} mono />
        <Evidence
          label="ENTROPY"
          value={`${artifact.entropy.toFixed(2)} bits/B`}
          sub="SHANNON / SAMPLED BYTES"
        />
        <Evidence
          label="FINGERPRINT"
          value={artifact.hash.toUpperCase()}
          sub="SHA-256 / FIRST 64 BITS"
          mono
        />

        {artifact.image && (
          <>
            <Evidence
              label="DIMENSIONS"
              value={`${artifact.image.width} × ${artifact.image.height}`}
              sub={
                artifact.image.sampleWidth !== artifact.image.width
                  ? `SCORING SAMPLE ${artifact.image.sampleWidth} × ${artifact.image.sampleHeight}`
                  : "FULL-RESOLUTION SCORING"
              }
            />
            <Evidence
              label="SAMPLE COLORS"
              value={artifact.image.swatches.length.toString()}
              sub="DOMINANT BUCKETS"
            />
            <div className="evidence wide">
              <span className="e-label">COLOR EVIDENCE</span>
              <div className="swatches">
                {artifact.image.swatches.map((swatch) => (
                  <i key={swatch} style={{ background: swatch }} title={swatch} />
                ))}
                <span className="swatch-codes">
                  {artifact.image.swatches.slice(0, 3).join("  ")}
                </span>
              </div>
            </div>
          </>
        )}

        {artifact.text && (
          <>
            <Evidence
              label="LINES"
              value={artifact.text.lines.toLocaleString()}
            />
            <Evidence
              label="WORDS"
              value={artifact.text.words.toLocaleString()}
            />
            <Evidence
              label="UNIQUE WORDS"
              value={artifact.text.uniques.toLocaleString()}
            />
            <Evidence
              label="TEXT SAMPLE"
              value={`${artifact.text.sample.length.toLocaleString()} chars`}
            />
          </>
        )}

        {artifact.binary && (
          <>
            <Evidence
              label="SECTIONS"
              value={artifact.binary.sections.length.toString()}
              sub={
                artifact.binary.headerInfo.find(([key]) => key === "CLASS")?.[1] ??
                "FORMAT HEADER"
              }
            />
            {artifact.binary.headerInfo.length > 0 && (
              <div className="evidence wide">
                <span className="e-label">PARSED HEADER</span>
                <div className="kv-list">
                  {artifact.binary.headerInfo.map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <b>{value}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {artifact.binary && artifact.binary.sections.length > 0 && (
        <div className="section-block">
          <header>
            SECTION TABLE <span>{artifact.binary.sections.length} PARSED</span>
          </header>
          <div className="section-list">
            {artifact.binary.sections.map((section, index) => (
              <div className="section-row" key={`${section.name}-${index}`}>
                <b>{section.name}</b>
                <span>0x{section.address.toString(16)}</span>
                <span>{fmtBytes(section.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {artifact.binary && (
        <div className="strings-block">
          <header>
            STRING EVIDENCE
            <span>{artifact.binary.strings.length} CAPTURED</span>
          </header>
          {artifact.binary.strings.length > 0 ? (
            <div className="string-chips">
              {artifact.binary.strings.map((string, index) => (
                <code key={`${string}-${index}`}>{string}</code>
              ))}
            </div>
          ) : (
            <p className="empty-note">No printable runs found in the sample.</p>
          )}
        </div>
      )}
    </section>
  );
}

export function Stage({
  run,
  onBrowse,
}: {
  run: RunState;
  onBrowse: () => void;
}) {
  const artifact = run.artifact;
  return (
    <section className="stage">
      <div className="artifact-bar">
        <span className={`kind-chip kind-${artifact.kind}`}>
          {artifact.kind.toUpperCase()}
        </span>
        <div className="artifact-id">
          <h2 title={artifact.name}>{artifact.name}</h2>
          <p>
            {artifact.format} <span>·</span> {fmtBytes(artifact.size)}{" "}
            <span>·</span> 0x{artifact.hash.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <button className="drop-again" type="button" onClick={onBrowse}>
          + NEW SPECIMEN
        </button>
      </div>

      {artifact.notes.length > 0 && (
        <div className="note-row">
          {artifact.notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      )}

      <Pipeline run={run} />
      <Preview run={run} />
      <Dissection artifact={artifact} />
    </section>
  );
}
