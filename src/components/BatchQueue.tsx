import { useState } from "react";
import { batchEntries, runBatch } from "../engine/batch";
import type { BatchRow } from "../engine/batch";
import { downloadBytes } from "../engine/export";
import type { Mind } from "../engine/types";
import { nextFrame, percent } from "../engine/util";
import { zipStore } from "../features/zip";

interface Item {
  name: string;
  status: "queued" | "running" | "done" | "error";
  row?: BatchRow;
}

export function BatchQueue({
  files,
  mind,
  onMind,
  onClose,
}: {
  files: File[];
  mind: Mind;
  onMind: (mind: Mind) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[]>(files.map((file) => ({ name: file.name, status: "queued" })));
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setRunning(true);
    setError(null);
    try {
      const result = await runBatch(files, mind, {
        yield: nextFrame,
        onStart: (index) => {
          setItems((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index ? { ...item, status: "running" } : item,
            ),
          );
        },
        onRow: (row, index) => {
          setItems((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index ? { ...item, status: row.error ? "error" : "done", row } : item,
            ),
          );
        },
      });
      onMind(result.mind);
      const blob = zipStore(batchEntries(result));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      downloadBytes(bytes, "mitosis-batch.zip", "application/zip");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The batch stopped");
    } finally {
      setRunning(false);
    }
  }

  const finished = items.filter((item) => item.row && !item.row.error).length;

  return (
    <section className="lab">
      <header className="sheet-head">
        <div className="sheet-copy">
          <p className="eyebrow">BATCH / {files.length} FILES</p>
          <h2>One session each</h2>
          <p className="lede">
            Each file is evolved on its own, seeded from memory when a past run of the same
            kind exists, then saved as a .clone. The zip also carries a summary report.
          </p>
        </div>
        <div className="sheet-actions">
          <button type="button" className="primary sheet-download" onClick={() => void run()} disabled={running || done}>
            {running ? "RUNNING" : done ? "SAVED" : "RUN BATCH"}
          </button>
          <button type="button" className="sheet-again" onClick={onClose} disabled={running}>
            CLOSE
          </button>
        </div>
      </header>

      <ol className="batch-list">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className={item.status}>
            <span>{item.name}</span>
            <b>
              {item.status === "done" && item.row
                ? `${percent(item.row.score, 1)} · ${item.row.cloneFile}${item.row.seededFrom ? ` · from ${item.row.seededFrom}` : ""}`
                : item.status === "error"
                  ? item.row?.error ?? "error"
                  : item.status === "running"
                    ? "EVOLVING"
                    : "QUEUED"}
            </b>
          </li>
        ))}
      </ol>

      {done && (
        <p className="evolve-note">
          {finished} .clone {finished === 1 ? "file" : "files"} and batch-report.md are in mitosis-batch.zip.
        </p>
      )}
      {error && <p className="error-message">{error}</p>}
    </section>
  );
}
