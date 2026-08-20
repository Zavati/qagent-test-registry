export class TestRegistryError extends Error {
  constructor(message, {
    code = "TEST_REGISTRY_ERROR",
    status = 400,
    retryable = false,
    path = null,
    details = null,
    cause = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TestRegistryError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.path = path;
    this.details = details;
  }
}

export function asTestRegistryError(error) {
  if (error instanceof TestRegistryError) return error;

  return new TestRegistryError("Test Registry operation failed.", {
    code: "TEST_REGISTRY_INTERNAL_ERROR",
    status: 500,
    retryable: true,
    cause: error,
  });
}
