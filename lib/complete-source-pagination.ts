export interface CompleteOffsetPaginationOptions {
  sourceLabel: string;
  pageSize: number;
  buildUrl: (offset: number, pageSize: number) => string;
  fetchImpl?: typeof fetch;
  headers?: HeadersInit;
  timeoutMs: number;
  retries?: number;
  retryDelayMs?: number;
  onProgress?: (total: number, offset: number) => void;
}

/**
 * Fetch a complete offset-paginated source snapshot or throw. There is no
 * partial-success return shape: callers that reconcile membership can only
 * reach their destructive phase after every page has been retrieved and
 * parsed as an array.
 */
export async function fetchCompleteOffsetPages<T>(
  options: CompleteOffsetPaginationOptions,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  const fetchImpl = options.fetchImpl ?? fetch;

  while (true) {
    let page: T[] | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= (options.retries ?? 0); attempt += 1) {
      try {
        const response = await fetchImpl(
          options.buildUrl(offset, options.pageSize),
          {
            headers: options.headers,
            signal: AbortSignal.timeout(options.timeoutMs),
          },
        );
        if (!response.ok) {
          throw new Error(
            `${options.sourceLabel} returned ${response.status} at offset ${offset}`,
          );
        }
        const body: unknown = await response.json();
        if (!Array.isArray(body)) {
          throw new Error(
            `${options.sourceLabel} returned a non-array page at offset ${offset}`,
          );
        }
        page = body as T[];
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= (options.retries ?? 0)) break;
        if ((options.retryDelayMs ?? 0) > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, options.retryDelayMs),
          );
        }
      }
    }

    if (!page) throw lastError;
    if (page.length === 0) break;
    all.push(...page);
    options.onProgress?.(all.length, offset);
    if (page.length < options.pageSize) break;
    offset += options.pageSize;
  }

  return all;
}
