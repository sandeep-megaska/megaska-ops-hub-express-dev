// A user-facing GST PDF popup must never spin forever. Every stage that can block on an
// external system (Shopify sync, invoice generation, logo fetch, render) is raced against a
// deadline so a stall surfaces as a legible error naming the stalled stage instead of an
// endless spinner. The per-call fetch/body-read timeouts still apply underneath; this is the
// outer backstop shared by the print-order and invoice PDF routes.
export class StageTimeoutError extends Error {
  constructor(public readonly stage: string, ms: number) {
    super(`${stage} did not finish within ${Math.round(ms / 1000)}s`);
    this.name = "StageTimeoutError";
  }
}

export function withDeadline<T>(stage: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StageTimeoutError(stage, ms)), ms);
  });
  return Promise.race([work, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}
