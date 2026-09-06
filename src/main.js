/**
 * @file src/main.js
 * @project Tomcat Diagnostic Service
 * @author Eddy Wiyatno <edkas07@gmail.com>
 * @license MIT
 * @description Entrypoint CLI aplikasi Tomcat Diagnostic Service.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. configArgument: Ekstrak argumen CLI `--config <path>` dan resolusikan ke path absolut.
 * 2. main:
 *    a. Muat dan validasi konfigurasi via `loadApplicationConfig()`.
 *    b. Instansiasi `DiagnosticApplication` dan jalankan `application.start()` (migrasi DB, HTTPS server, worker loop).
 *    c. Tangani kegagalan startup dengan mencatat error ke stderr dan set exitCode = 1.
 *    d. Pasang signal handlers (`installSignalHandlers`) untuk menangkap sinyal OS SIGTERM dan SIGINT.
 * 3. installSignalHandlers:
 *    a. Cegah shutdown berulang dengan flag `shuttingDown`.
 *    b. Eksekusi `application.shutdown()` secara aman (tutup server HTTPS, hentikan worker, tutup database SQLite).
 *
 * Tanggung Jawab:
 * - Parsing argumen CLI `--config <absolute-path>` untuk memuat konfigurasi aplikasi.
 * - Menginisialisasi dan memulai DiagnosticApplication (migrasi SQLite, HTTPS server, single worker loop).
 * - Mendaftarkan signal handler OS (SIGTERM dan SIGINT) untuk proses graceful shutdown yang aman.
 * - Mengembalikan exit code 1 pada kegagalan startup atau shutdown.
 */

import { resolve } from "node:path";
import { DiagnosticApplication } from "./application/application.js";
import { loadApplicationConfig } from "./application/config-loader.js";

/**
 * Mengurai argumen baris perintah untuk mendapatkan path berkas konfigurasi.
 * @param {string[]} argv - Daftar argumen CLI.
 * @returns {string} Path absolut berkas konfigurasi.
 */
function configArgument(argv) {
  const index = argv.indexOf("--config");
  if (index === -1 || !argv[index + 1]) throw new TypeError("usage: node src/main.js --config <absolute-path>");
  return resolve(argv[index + 1]);
}

export function installSignalHandlers(application, runtime = process) {
  let shuttingDown = false;
  const stop = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await application.shutdown(); }
    catch (error) { runtime.stderr.write(`Tomcat Diagnostic Service shutdown failed: ${error.name}\n`); runtime.exitCode = 1; }
  };
  runtime.once("SIGTERM", stop);
  runtime.once("SIGINT", stop);
  return stop;
}

export async function main(argv = process.argv.slice(2), runtime = process) {
  let application;
  try {
    application = new DiagnosticApplication(loadApplicationConfig(configArgument(argv)));
    await application.start();
  } catch (error) {
    runtime.stderr.write(`Tomcat Diagnostic Service startup failed: ${error.name}\n`);
    runtime.exitCode = 1;
    return null;
  }
  installSignalHandlers(application, runtime);
  return application;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
