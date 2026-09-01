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
