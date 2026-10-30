/**
 * Timeouts and polling for provider calls. Mutable on purpose: tests shorten them (a stub server that never answers would
 * otherwise make the suite wait 10 s per call). Production never touches them.
 */
export const onlineMeetingTuning = {
  /** per provider HTTP call */
  timeoutMs: 10_000,
  /** Google Meet: how often / how many times to look for the link while the conference is still `pending` */
  pollDelayMs: 1_000,
  pollTries: 5,
  /** how long a worker may keep an event / meeting row to itself while it talks to a provider */
  leaseSeconds: 90,
  /** give up on one run after this long (several provider calls may follow each other) */
  runBudgetMs: 75_000,
};
