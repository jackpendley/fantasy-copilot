// Every feed read gives up after this long: a request that hangs would otherwise hold its
// page or scheduled job until the platform's limit (300 s on Vercel).
export const READ_TIMEOUT_MS = 15_000;

/** The abort signal for one read. */
export const readTimeout = () => AbortSignal.timeout(READ_TIMEOUT_MS);
