import { writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
if (!directory) throw new TypeError("component directory is required");

writeFileSync(join(directory, "bearer-token"), "tn010-component-token\n", { mode: 0o600 });
writeFileSync(join(directory, "targets.json"), JSON.stringify([
  { identity: { environment: "component", host: "tomcat-01", tomcat_instance: "default" } }
]));
writeFileSync(join(directory, "application.json"), JSON.stringify({
  schemaVersion: 1,
  listen: { host: "0.0.0.0", port: 8443 },
  databasePath: "/run/tomcat-diagnostic/diagnostic.sqlite",
  tls: { certificateFile: "/run/tomcat-diagnostic/server.crt", privateKeyFile: "/run/tomcat-diagnostic/server.key" },
  bearerTokenFile: "/run/tomcat-diagnostic/bearer-token",
  targetAllowlistFile: "/run/tomcat-diagnostic/targets.json",
  smtp: { host: "127.0.0.1", port: 2525, secure: false, from: "diagnostic@example.invalid", to: "operator@example.invalid" },
  queue: { capacity: 50, pollIntervalMs: 25 },
  timeouts: { diagnosticMs: 1000, smtpMs: 1000, shutdownMs: 2000 },
  requestLimitBytes: 262144
}));
