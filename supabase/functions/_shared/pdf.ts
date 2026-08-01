/**
 * Minimal single-page PDF writer — no dependencies, no CDN imports.
 *
 * Produces PDF 1.4 with the two built-in Helvetica faces and uncompressed
 * text streams. Deliberately tiny: the voucher is a typed A4 page of text,
 * and pulling a 2 MB library through esm.sh into an Edge Function for that
 * trade is the wrong one. Uncompressed streams also make the snapshot-policy
 * gate testable by grepping the PDF bytes.
 *
 * Text is Latin-1 only; sanitize() folds the few richer characters we use.
 */

export interface PdfLine {
  text: string;
  size?: number;      // pt, default 10
  bold?: boolean;
  gap?: number;       // extra pt below the line
  color?: [number, number, number]; // 0..1 RGB, default ink
}

const PAGE_W = 595.28; // A4 portrait, pt
const PAGE_H = 841.89;
const MARGIN_X = 56;
const TOP_Y = PAGE_H - 64;

function sanitize(s: string): string {
  return s
    .replaceAll("→", "->")
    .replaceAll("·", "-")
    .replaceAll("—", "-")
    .replaceAll("–", "-")
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("★", "*")
    // Anything else outside Latin-1 becomes '?'; better than a broken stream.
    .replace(/[^\x20-\xFF\n]/g, "?");
}

function esc(s: string): string {
  return s.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

/** Rough width for Helvetica at size 10 ≈ 0.5 * size per char — wrap helper. */
export function wrap(text: string, size: number, maxWidth = PAGE_W - 2 * MARGIN_X): string[] {
  const maxChars = Math.floor(maxWidth / (size * 0.5));
  const words = sanitize(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines.length ? lines : [""];
}

export function buildPdf(lines: PdfLine[]): Uint8Array {
  // Content stream: absolute text matrix per line, top-down.
  let y = TOP_Y;
  const parts: string[] = [];
  for (const l of lines) {
    const size = l.size ?? 10;
    const font = l.bold ? "/F2" : "/F1";
    const [r, g, b] = l.color ?? [0.078, 0.141, 0.122]; // Corlington ink
    if (y < 64) break; // single page; the voucher never legitimately overflows
    parts.push(
      `BT ${font} ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ` +
        `1 0 0 1 ${MARGIN_X} ${y.toFixed(2)} Tm (${esc(sanitize(l.text))}) Tj ET`,
    );
    y -= size + (l.gap ?? 4);
  }
  const stream = parts.join("\n");

  const objects: string[] = [];
  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  objects[3] =
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
    `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n`;
  objects[4] =
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  objects[5] =
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[6] =
    `6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 6; i++) {
    offsets[i] = out.length;
    out += objects[i];
  }
  const xrefPos = out.length;
  out += "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i++) {
    out += offsets[i].toString().padStart(10, "0") + " 00000 n \n";
  }
  out += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  // Latin-1 encode byte-for-byte (TextEncoder would UTF-8-expand ≥0x80 and
  // desync the xref offsets).
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
