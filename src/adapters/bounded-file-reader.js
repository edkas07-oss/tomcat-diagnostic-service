/**
 * @file src/adapters/bounded-file-reader.js
 * @project Tomcat Diagnostic Service
 * @description Pembaca file sistem lokal dengan batas ukuran, jumlah baris, dan proteksi path traversal ketat.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. inside(root, candidate):
 *    - Periksa apakah candidate berada di bawah direktori root menggunakan perbandingan relative path (tanpa awalan `..`).
 * 2. readBoundedFile(rootDirectory, relativePath, options):
 *    a. Tolak jika relativePath berformat path absolut.
 *    b. Resolusikan realpath direktori root.
 *    c. Gabungkan path dan periksa apakah path keluar dari root (`inside`).
 *    d. Periksa `lstatSync()`; tolak jika merupakan symbolic link.
 *    e. Resolusikan `realpathSync()` berkas aktual dan pastikan tetap di dalam root.
 *    f. Buka file descriptor secara read-only.
 *    g. Alokasikan buffer berukuran `maxBytes + 1` dan baca byte file.
 *    h. Potong teks utf-8 pada batas `maxBytes` dan batasi jumlah baris maksimal `maxLines`.
 *    i. Kembalikan objek `{ text, bytesRead, linesRead, truncated }`.
 *    j. Tutup file descriptor di blok finally.
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
