/**
 * @file src/adapters/bounded-file-reader.js
 * @project Tomcat Diagnostic Service
 * @description Pembaca file sistem lokal dengan batas ukuran, jumlah baris, dan proteksi path traversal ketat.
 *
 * Prinsip & Batasan Arsitektur (TN-006):
 * - Anti-Traversal: Menolak path relatif yang keluar dari direktori root terkonfigurasi.
 * - Anti-Symlink: Menolak symbolic link guna mencegah eksfiltrasi file host di luar direktori aman.
 * - Resource Bounded: Membatasi pembacaan maksimal buffer byte (`maxBytes`) dan baris (`maxLines`).
 */

import { lstatSync, openSync, closeSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function readBoundedFile(rootDirectory, relativePath, { maxBytes = 512 * 1024, maxLines = 500 } = {}) {
  if (isAbsolute(relativePath)) throw new RangeError("evidence path must be relative to configured root");
  const root = realpathSync(rootDirectory);
  const requested = resolve(root, relativePath);
  if (!inside(root, requested)) throw new RangeError("evidence path escapes configured root");
  if (lstatSync(requested).isSymbolicLink()) throw new RangeError("symbolic-link evidence is rejected");
  const actual = realpathSync(requested);
  if (!inside(root, actual)) throw new RangeError("resolved evidence path escapes configured root");

  const handle = openSync(actual, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const bytesRead = readSync(handle, buffer, 0, buffer.length, 0);
    const truncatedBytes = bytesRead > maxBytes;
    const text = buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString("utf8");
    const lines = text.split(/\r?\n/);
    const truncatedLines = lines.length > maxLines;
    return {
      text: lines.slice(0, maxLines).join("\n"),
      bytesRead: Math.min(bytesRead, maxBytes),
      linesRead: Math.min(lines.length, maxLines),
      truncated: truncatedBytes || truncatedLines
    };
  } finally {
    closeSync(handle);
  }
}
