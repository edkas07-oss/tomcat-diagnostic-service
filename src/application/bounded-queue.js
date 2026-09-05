/**
 * @file src/application/bounded-queue.js
 * @project Tomcat Diagnostic Service
 * @description Pengelola antrean kerja berbatas kapasitas (Bounded Queue) untuk tugas diagnosis asinkron.
 *
 * Pseudocode Alur Eksekusi:
 * ------------------------
 * 1. BoundedWorkQueue.constructor(repository, { capacity }):
 *    - Validasi parameter kapasitas (harus bilangan bulat positif >= 1).
 *    - Simpan referensi repository dan batas kapasitas antrean.
 * 2. accept(request):
 *    - Teruskan request ke `repository.accept()` dengan batas queueCapacity.
 * 3. claim():
 *    - Klaim tugas tertua yang siap diproses via `repository.claimNext()`.
 * 4. complete(queueId, succeeded):
 *    - Finalisasi status tugas antrean via `repository.complete()`.
 *
 * Prinsip & Batasan Arsitektur (TN-005):
 * - Kapasitas Berbatas Ketat: Default kapasitas maksimum 50 item antrean (`work_queue`) untuk mencegah kehabisan memori/disk.
 * - Penolakan Transaksional: Melempar `QueueCapacityError` ketika batas kapasitas terlampaui sehingga request di-rollback.
 * - Interface Sekuensial: Menyediakan batas kontrak claim dan complete bagi worker pemroses.
 */

export class QueueCapacityError extends Error {
  constructor(limit) {
    super(`accepted-work queue capacity ${limit} reached`);
    this.name = "QueueCapacityError";
    this.limit = limit;
  }
}

export class BoundedWorkQueue {
  constructor(repository, { capacity = 50 } = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError("queue capacity must be a positive safe integer");
    }
    this.repository = repository;
    this.capacity = capacity;
  }

  accept(request) {
    return this.repository.accept(request, { queueCapacity: this.capacity });
  }

  claim() {
    return this.repository.claimNext();
  }

  complete(queueId, succeeded = true) {
    this.repository.complete(queueId, succeeded);
  }
}
