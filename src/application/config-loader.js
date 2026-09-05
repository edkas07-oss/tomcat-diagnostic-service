/**
 * @file src/application/config-loader.js
 * @project Tomcat Diagnostic Service
 * @description Pemuat dan validator berkas konfigurasi runtime aplikasi (TM-ADR-0016).
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. loadApplicationConfig(configPath, options):
 *    a. Validasi path konfigurasi (harus path absolut yang dinormalisasi).
 *    b. Baca konfigurasi mentah JSON dan skema JSON schema `application-config-v1.schema.json`.
 *    c. Kompilasi dan validasi via Ajv2020 mode strict; lempar ConfigurationError jika gagal.
 *    d. Validasi semua referensi berkas (databasePath, tls, bearerTokenFile, targets, smtp).
 *    e. Muat daftar target allowlist dan instansiasi `TargetRegistry`.
 *    f. Baca isi berkas rahasia mounted (TLS key/cert, Bearer token, SMTP credentials).
 *    g. Kembalikan objek konfigurasi ter-freeze (`Object.freeze`) yang immutable.
 *
 * Prinsip & Batasan Arsitektur:
 * - Immutable Configuration: Konfigurasi dibekukan saat startup untuk mencegah mutasi runtime.
 * - Secret Mount Isolation: Membaca token dan sertifikat dari berkas mounted tanpa mencatatnya di log.
 * - Path Normalization: Mengharuskan path absolut ter-normalisasi untuk mencegah path traversal.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { TargetRegistry } from "./target-registry.js";

export class ConfigurationError extends Error {
  constructor(message, cause) { super(message, { cause }); this.name = "ConfigurationError"; }
}

function readJson(path, description) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new ConfigurationError(`cannot read ${description}`, error); }
}

function absolutePath(value, field) {
  if (!isAbsolute(value) || normalize(value) !== value) throw new ConfigurationError(`${field} must be an absolute normalized path`);
  return value;
}

function readMountedFile(path, field, { secret = false } = {}) {
  absolutePath(path, field);
  try {
    const value = readFileSync(path, secret ? undefined : "utf8");
    if (secret) {
      const trimmed = value.toString("utf8").trim();
      if (!trimmed) throw new Error("file is empty");
      return trimmed;
    }
    return value;
  } catch (error) { throw new ConfigurationError(`cannot read mounted file for ${field}`, error); }
}

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function loadApplicationConfig(configPath, { schemaPath = join(projectRoot, "config/schemas/application-config-v1.schema.json") } = {}) {
  absolutePath(configPath, "configPath");
  const raw = readJson(configPath, "application configuration");
  const schema = readJson(schemaPath, "application configuration schema");
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(raw)) throw new ConfigurationError("application configuration does not match schema v1");
  for (const [field, value] of [["databasePath", raw.databasePath], ["tls.certificateFile", raw.tls.certificateFile], ["tls.privateKeyFile", raw.tls.privateKeyFile], ["bearerTokenFile", raw.bearerTokenFile], ["targetAllowlistFile", raw.targetAllowlistFile]]) absolutePath(value, field);
  if (raw.smtp.usernameFile) { absolutePath(raw.smtp.usernameFile, "smtp.usernameFile"); absolutePath(raw.smtp.passwordFile, "smtp.passwordFile"); }
  const targets = readJson(raw.targetAllowlistFile, "target allowlist");
  if (!Array.isArray(targets) || targets.length === 0) throw new ConfigurationError("target allowlist must be a non-empty JSON array");
  let targetRegistry;
  try { targetRegistry = new TargetRegistry(targets); } catch (error) { throw new ConfigurationError("target allowlist is invalid", error); }
  return Object.freeze({
    ...raw,
    tls: Object.freeze({ key: readMountedFile(raw.tls.privateKeyFile, "tls.privateKeyFile"), cert: readMountedFile(raw.tls.certificateFile, "tls.certificateFile") }),
    bearerToken: readMountedFile(raw.bearerTokenFile, "bearerTokenFile", { secret: true }),
    targetRegistry,
    smtp: Object.freeze({ ...raw.smtp, timeoutMs: raw.timeouts.smtpMs, username: raw.smtp.usernameFile ? readMountedFile(raw.smtp.usernameFile, "smtp.usernameFile", { secret: true }) : undefined, password: raw.smtp.passwordFile ? readMountedFile(raw.smtp.passwordFile, "smtp.passwordFile", { secret: true }) : undefined })
  });
}
