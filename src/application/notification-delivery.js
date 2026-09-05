/**
 * @file src/application/notification-delivery.js
 * @project Tomcat Diagnostic Service
 * @description Orkestrator pengiriman notifikasi insiden dengan kebijakan retry terikat (bounded retry policy).
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. notificationErrorCode(error):
 *    - Kategorisasi kode error Node.js/Nodemailer menjadi kode kanonikal:
 *      ETIMEDOUT -> 'timeout', EAUTH -> 'authentication', ECONN* -> 'connection', responseCode 5xx -> 'smtp_5xx', dll.
 * 2. NotificationDelivery.deliver(resultId, result, rendered):
 *    a. Catat waktu mulai pengiriman (startedAt).
 *    b. Loop percobaan pengiriman dari attempt = 1 hingga `policy.maxAttempts` (3):
 *       - Jika attempt > 1: hitung delay backoff (1000ms, 5000ms).
 *       - Periksa batas umur total (`maxAgeMs` 60s); jika terlampaui hentikan retry loop.
 *       - Tunggu selama delay (`sleep(delay)`).
 *       - Catat permulaan upaya ke tabel `notification_attempts` (status pending).
 *       - Eksekusi pengiriman email via `smtp.send(result, rendered)`.
 *       - Jika berhasil: update status menjadi 'sent' pada database dan naikkan metrik ketersediaan. Kembalikan `{ status: 'sent', attempts }`.
 *       - Jika gagal: kategorikan error code via `notificationErrorCode(error)` dan update status menjadi 'failed'.
 *    c. Jika semua percobaan gagal: catat kegagalan akhir ke metrik dan kembalikan `{ status: 'failed', attempts, errorCode }`.
 *
 * Prinsip & Batasan Arsitektur (TN-008, TN-012):
 * - Bounded Retry Policy: Maksimal 3 kali percobaan (attempt 1, backoff 1s, backoff 5s) dengan usia maksimal 60 detik.
 * - Categorized Error Codes: Memetakan kegagalan transport ke kode kanonikal (`timeout`, `authentication`, `connection`, `smtp_5xx`, `smtp_4xx`).
 * - Idempotent Persistence: Mencatat setiap riwayat upaya pengiriman ke tabel `notification_attempts`.
 */

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const NOTIFICATION_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  backoffMs: Object.freeze([1000, 5000]),
  maxAgeMs: 60000
});

export function notificationErrorCode(error) {
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(error?.code)) return "timeout";
  if (error?.code === "EAUTH") return "authentication";
  if (["ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(error?.code)) return "connection";
  if (Number.isInteger(error?.responseCode)) return error.responseCode >= 500 ? "smtp_5xx" : "smtp_4xx";
  return "unknown";
}

export class NotificationDelivery {
  constructor(repository, smtp, {
    policy = NOTIFICATION_RETRY_POLICY,
    sleep = defaultSleep,
    clock = () => Date.now(),
    health
  } = {}) {
    this.repository = repository;
    this.smtp = smtp;
    this.policy = policy;
    this.sleep = sleep;
    this.clock = clock;
    this.health = health;
  }

  async deliver(resultId, result, rendered) {
    const startedAt = this.clock();
    let attempts = 0;
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        const delay = this.policy.backoffMs[attempt - 2];
        if (delay === undefined || this.clock() - startedAt + delay > this.policy.maxAgeMs) break;
        await this.sleep(delay);
      }
      attempts = attempt;
      this.repository.beginNotificationAttempt(resultId, attempt);
      try {
        await this.smtp.send(result, rendered);
        this.repository.finishNotificationAttempt(resultId, attempt, "sent");
        this.health?.increment("notification_attempts_total", { status: "sent" });
        this.health?.increment("notification_deliveries_total", { status: "sent" });
        return { status: "sent", attempts };
      } catch (error) {
        this.repository.finishNotificationAttempt(resultId, attempt, "failed", notificationErrorCode(error));
        this.health?.increment("notification_attempts_total", { status: "failed" });
      }
    }
    this.health?.increment("notification_deliveries_total", { status: "failed" });
    return { status: "failed", attempts };
  }
}
