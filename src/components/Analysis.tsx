import { useEffect, useRef, useState } from "react";
import {
  analyzeMachO,
  downloadMachOReport,
  isMachOArtifact,
  type MachOAnalysis,
  type MachOSymbol,
} from "../engine/macho";
import type { RunState } from "../model";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Analysis failed.";
}

function symbolLabel(symbol: MachOSymbol): string {
  return symbol.demangled ?? symbol.name;
}

function hasSignature(symbol: MachOSymbol): boolean {
  return Boolean(symbol.demangled && symbol.demangled.includes("("));
}

export function Analysis({ run }: { run: RunState }) {
  const isMachO = isMachOArtifact(run.artifact.format);
  const [report, setReport] = useState<MachOAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    request.current++;
    setReport(null);
    setError(null);
    setBusy(false);
    return () => {
      request.current++;
    };
  }, [run.artifact.hash]);

  if (!isMachO) return null;

  async function runAnalysis(): Promise<void> {
    if (!run.sourceFile) {
      setError("The original file is no longer available.");
      return;
    }
    const token = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const result = await analyzeMachO(run.sourceFile);
      if (token !== request.current) return;
      if (!result) {
        setError("The dropped item is not a parseable Mach-O image.");
        return;
      }
      setReport(result);
    } catch (caught) {
      if (token === request.current) setError(errorText(caught));
    } finally {
      if (token === request.current) setBusy(false);
    }
  }

  return (
    <section className="panel analysis-panel">
      <div className="panel-head">
        <div className="ph-title">
          DEEP ANALYSIS <em>MACH-O / GHIDRA-STYLE</em>
        </div>
        <span className="ph-note">LOCAL PARSER · NO GHIDRA REQUIRED</span>
      </div>

      <div className="analysis-intro">
        <p>
          Static evidence from the executable inside the dropped item: segments,
          sections, <code>LC_SYMTAB</code> symbols, linked dylibs, and printable
          strings. Swift and Objective-C symbols are recovered into readable
          names, with the raw symbol kept alongside them. This is structural
          analysis, not decompilation.
        </p>
        <button
          type="button"
          className="download analysis-run"
          onClick={() => {
            void runAnalysis();
          }}
          disabled={busy}
        >
          {busy ? "ANALYZING…" : report ? "RE-ANALYZE" : "RUN ANALYSIS"}
        </button>
      </div>

      {error && <p className="analysis-error">{error}</p>}

      {report ? (
        <>
          <div className="analysis-summary">
            <div>
              <span>ARCHITECTURES</span>
              <b>{report.totals.architectures}</b>
            </div>
            <div>
              <span>SECTIONS</span>
              <b>{report.totals.sections.toLocaleString()}</b>
            </div>
            <div>
              <span>SYMBOLS</span>
              <b>{report.totals.symbols.toLocaleString()}</b>
            </div>
            <div>
              <span>STRINGS</span>
              <b>{report.totals.strings.toLocaleString()}</b>
            </div>
            <div>
              <span>LIBRARIES</span>
              <b>{report.totals.libraries.toLocaleString()}</b>
            </div>
          </div>

          <div className="analysis-summary analysis-recovery">
            <div>
              <span>SWIFT SYMBOLS</span>
              <b>{report.totals.swiftSymbols.toLocaleString()}</b>
            </div>
            <div>
              <span>OBJC CLASSES</span>
              <b>{report.totals.objcClasses.toLocaleString()}</b>
            </div>
            <div>
              <span>OBJC METHODS</span>
              <b>{report.totals.objcMethods.toLocaleString()}</b>
            </div>
          </div>

          <div className="analysis-archs">
            {report.architectures.map((architecture) => {
              const objc = architecture.objectiveC;
              const nameItems = objc.classes.length ? objc.classes : objc.protocols;
              const nameHeading = objc.classes.length
                ? "OBJECTIVE-C CLASSES"
                : "OBJECTIVE-C PROTOCOLS";
              const methodItems = objc.methods.length
                ? objc.methods.map((method) => method.demangled)
                : objc.selectors;
              const methodHeading = objc.methods.length
                ? "OBJECTIVE-C METHODS"
                : "OBJECTIVE-C SELECTORS";
              const signatures = architecture.symbols.filter(hasSignature);
              const symbolPreview = (signatures.length
                ? signatures
                : architecture.symbols
              ).slice(0, 3);

              return (
                <article
                  className="analysis-arch"
                  key={`${architecture.name}-${architecture.offset}`}
                >
                  <header>
                    <b>{architecture.name}</b>
                    <span>
                      {architecture.fileType} · {architecture.bitness}-bit{" "}
                      {architecture.endian}
                    </span>
                  </header>
                  <div className="analysis-meta">
                    <span>{architecture.sections.length} sections</span>
                    <span>{architecture.symbols.length.toLocaleString()} symbols</span>
                    <span>{architecture.strings.length.toLocaleString()} strings</span>
                    <span>{architecture.libraries.length} libraries</span>
                    <span>{architecture.swiftSymbols.toLocaleString()} Swift</span>
                    <span>{objc.classes.length} ObjC classes</span>
                  </div>
                  <div className="analysis-cols">
                    <div>
                      <span>LINKED LIBRARIES</span>
                      {architecture.libraries.length ? (
                        architecture.libraries.slice(0, 4).map((library) => (
                          <code key={library} title={library}>
                            {library}
                          </code>
                        ))
                      ) : (
                        <em>none recorded</em>
                      )}
                    </div>
                    <div>
                      <span>
                        {signatures.length
                          ? `RECOVERED SIGNATURES · ${signatures.length.toLocaleString()}`
                          : "FIRST SYMBOLS · RECOVERED"}
                      </span>
                      {symbolPreview.length ? (
                        symbolPreview.map((symbol, index) => (
                          <code
                            className={hasSignature(symbol) ? "analysis-sig" : undefined}
                            key={`${symbol.name}-${index}`}
                            title={
                              symbol.demangled
                                ? `${symbol.demangled}\n${symbol.name}`
                                : symbol.name
                            }
                          >
                            {symbolLabel(symbol)}
                          </code>
                        ))
                      ) : (
                        <em>no non-debug symbols</em>
                      )}
                    </div>
                  </div>
                  {(nameItems.length > 0 || methodItems.length > 0) && (
                    <div className="analysis-cols analysis-objc">
                      <div>
                        <span>{nameHeading}</span>
                        {nameItems.length ? (
                          nameItems.slice(0, 6).map((name) => (
                            <code key={`${nameHeading}-${name}`} title={name}>
                              {name}
                            </code>
                          ))
                        ) : (
                          <em>none recovered</em>
                        )}
                        {nameItems.length > 6 && (
                          <em>+{(nameItems.length - 6).toLocaleString()} more in export</em>
                        )}
                      </div>
                      <div>
                        <span>{methodHeading}</span>
                        {methodItems.length ? (
                          methodItems.slice(0, 6).map((name, index) => (
                            <code key={`${methodHeading}-${name}-${index}`} title={name}>
                              {name}
                            </code>
                          ))
                        ) : (
                          <em>none recovered</em>
                        )}
                        {methodItems.length > 6 && (
                          <em>+{(methodItems.length - 6).toLocaleString()} more in export</em>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="analysis-actions">
            <button
              type="button"
              className="download"
              onClick={() => downloadMachOReport(report, "json")}
            >
              EXPORT .JSON
            </button>
            <button
              type="button"
              className="download"
              onClick={() => downloadMachOReport(report, "markdown")}
            >
              EXPORT .MD
            </button>
          </div>
          <p className="pane-note">
            JSON contains the complete symbol and string tables, including raw and
            recovered names. Markdown adds a readable Objective-C section and
            capped symbol tables. All analysis runs locally and the file is never
            uploaded.
          </p>
        </>
      ) : (
        <p className="card-copy analysis-placeholder">
          Run the analyzer to build a report from the executable. It reads up to 64
          MB locally; no Ghidra installation is needed.
        </p>
      )}
    </section>
  );
}
