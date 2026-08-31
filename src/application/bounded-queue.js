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
