import { encodeWav } from "./engine/audio";
import { buildPdf } from "./engine/pdf";
import { mulberry32 } from "./engine/util";

function fileBytes(bytes: Uint8Array, name: string, type: string): File {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type });
}

async function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not encode specimen");
  return new File([blob], name, { type: "image/png" });
}

export async function imageSpecimen(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 880;
  canvas.height = 560;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const bg = ctx.createLinearGradient(0, 0, 880, 560);
  bg.addColorStop(0, "#07110c");
  bg.addColorStop(0.55, "#0d1d13");
  bg.addColorStop(1, "#1a2a1b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 880, 560);

  const glow = ctx.createRadialGradient(470, 250, 20, 470, 250, 360);
  glow.addColorStop(0, "rgba(198,255,74,0.33)");
  glow.addColorStop(0.5, "rgba(129,196,86,0.12)");
  glow.addColorStop(1, "rgba(7,17,12,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 880, 560);

  ctx.strokeStyle = "rgba(198,255,74,0.10)";
  ctx.lineWidth = 1;
  for (let x = 40; x < 880; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 560);
    ctx.stroke();
  }
  for (let y = 40; y < 560; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(880, y);
    ctx.stroke();
  }

  const sun = ctx.createRadialGradient(315, 246, 16, 315, 246, 152);
  sun.addColorStop(0, "#f1ffc0");
  sun.addColorStop(0.55, "#c6ff4a");
  sun.addColorStop(1, "#7dab2c");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(315, 246, 138, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(123,224,195,0.55)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(505, 262, 126 + i * 34, -0.55, 2.2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,180,84,0.18)";
  ctx.beginPath();
  ctx.moveTo(608, 84);
  ctx.lineTo(806, 382);
  ctx.lineTo(520, 400);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(233,241,227,0.26)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(315, 108);
  ctx.lineTo(315, 384);
  ctx.moveTo(177, 246);
  ctx.lineTo(453, 246);
  ctx.stroke();

  const cells = [
    [655, 172, 34, 0.9],
    [722, 305, 17, 0.55],
    [586, 388, 12, 0.45],
    [756, 118, 9, 0.6],
  ] as const;
  for (const [x, y, r, alpha] of cells) {
    ctx.fillStyle = `rgba(123,224,195,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const rng = mulberry32(1776);
  for (let i = 0; i < 1400; i++) {
    const x = Math.floor(rng() * 880);
    const y = Math.floor(rng() * 560);
    const alpha = rng() * 0.12;
    ctx.fillStyle =
      rng() > 0.45 ? `rgba(198,255,74,${alpha})` : `rgba(233,241,227,${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.fillStyle = "rgba(233,241,227,0.72)";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("MITOSIS / SPECIMEN 01", 42, 58);
  ctx.fillText("CELLULAR STUDY · 880×560", 42, 78);
  ctx.textAlign = "right";
  ctx.fillText("DROP / DISSECT / RECUR", 838, 58);
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(233,241,227,0.92)";
  ctx.font = "italic 58px Georgia, 'Times New Roman', serif";
  ctx.fillText("a better copy", 42, 492);
  ctx.fillStyle = "rgba(198,255,74,0.85)";
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("SPECIMEN 01 — DO NOT ARCHIVE", 44, 522);

  ctx.strokeStyle = "rgba(198,255,74,0.35)";
  ctx.strokeRect(20, 20, 840, 520);

  return canvasToFile(canvas, "specimen-cell.png");
}

export function textSpecimen(): File {
  const text = `# FIELD NOTES / SPECIMEN 14

The artifact does not announce what it is. It arrives as a surface, a set of
edges, a pattern of small decisions made by someone who is no longer in the
room. Our job is not to judge the surface. Our job is to notice the rules
underneath it.

Every clone begins as an act of attention. We measure the obvious things first:
size, entropy, the shape of the header, the way the bytes gather into blocks.
Then we look for the repeat. A logo repeats its curve. A document repeats its
cadence. A binary repeats the small rituals of its compiler. The repeat is the
signature, and the signature is what we keep.

## Observations

1. The first attempt is always crude. It has the silhouette but not the grain.
2. Fidelity and novelty pull against each other. A perfect copy remembers
   everything and discovers nothing.
3. Memory is not a warehouse. It is a set of instructions for the next attempt.
4. The lab improves when it stops asking what the artifact is and starts asking
   what the artifact does.

The image class teaches us patience. At four colors, the subject becomes a flag.
At sixteen colors, it becomes a photograph again. At sixty-four colors, the eye
stops counting and begins to trust the reconstruction. The difference between
these states is not magic. It is a number, changed one generation at a time.

The text class teaches us restraint. Order one produces a word salad with the
correct vocabulary. Order four produces sentences that almost remember where
they were going. The best clone is not the longest one. The best clone is the
one that keeps the cadence while leaving room for a stranger to speak.

The binary class teaches us humility. A section table is a map drawn by the
people who made the file. It is useful, but it is not the territory. Entropy
tells us where the information hides. The header tells us what the file wants
us to believe. We record both, and we mark the difference as evidence.

## Method

Drop the artifact. Dissect it without flattery. Recall what worked before.
Synthesize a candidate. Score it against the original. Keep the mutations that
move the score, discard the rest, and write the survivors into memory. Repeat
until the shape holds.

This is the whole method. It is also the whole promise: nothing here is copied
byte for byte. Everything here is reconstructed from evidence, and the lab is
different after every attempt.

-- the night shift, memory bank 03`;
  return new File([text], "field-notes.md", { type: "text/markdown" });
}

export function binarySpecimen(): File {
  const total = 64 * 1024;
  const bytes = new Uint8Array(total);
  const rng = mulberry32(9091);
  const header = new TextEncoder().encode(
    "MITOSIS::SPECIMEN::MEMORY_BANK\nVERSION=03\nCLASS=UNKNOWN\n",
  );
  bytes.set(header, 0);

  let cursor = header.length;
  const phrase = new TextEncoder().encode(
    "the artifact remembers / the lab forgets / repeat until the shape holds\n",
  );
  for (let section = 0; section < 7 && cursor < total; section++) {
    const end = Math.min(total, cursor + 4800);
    if (section % 3 === 0) {
      for (let i = cursor; i < end; i++) {
        bytes[i] = (i * 37 + section * 11) & 0xff;
      }
    } else if (section % 3 === 1) {
      for (let i = cursor; i < end; i++) {
        bytes[i] = phrase[(i - cursor) % phrase.length];
      }
    } else {
      for (let i = cursor; i < end; i++) {
        bytes[i] = Math.floor(rng() * 256);
      }
    }
    cursor = end;
  }

  const marker = new TextEncoder().encode(
    "END_OF_RECORD::RETAIN::RECALL::REFLECT\n",
  );
  bytes.set(marker.slice(0, Math.max(0, total - cursor)), cursor);

  return new File([bytes], "specimen.bin", { type: "application/octet-stream" });
}

export function audioSpecimen(): File {
  const sampleRate = 8000;
  const length = 4000;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = 0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 3 * t));
    samples[i] =
      envelope *
      (0.7 * Math.sin(2 * Math.PI * 220 * t) + 0.35 * Math.sin(2 * Math.PI * 660 * t));
  }
  return fileBytes(encodeWav(samples, sampleRate), "specimen-tone.wav", "audio/wav");
}

export function pdfSpecimen(): File {
  return fileBytes(
    buildPdf(
      "Field notes. The cell divides. The table holds the mass of every trial. A page remembers the order of the words and the margin where the pencil stopped.",
      12,
    ),
    "specimen-page.pdf",
    "application/pdf",
  );
}

export function sheetSpecimen(): File {
  const csv = [
    "trial,mass,note",
    "01,1.2,alpha",
    "02,1.8,beta",
    "03,2.1,alpha",
    "04,2.6,gamma",
    "05,3.0,beta",
    "06,3.4,gamma",
  ].join("\n");
  return new File([csv], "specimen-table.csv", { type: "text/csv" });
}
