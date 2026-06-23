/**
 * Promise-coalescing single-flight (TASK-36.3.1).
 *
 * While an operation is in flight, concurrent callers join the SAME promise
 * rather than starting a second run; the holder's `in_flight` latch is cleared
 * when the operation settles (success OR failure), so the next call starts
 * fresh. Used to keep the TDT embed pass single — one model load, no two passes
 * racing writes to the same `topic_page_vector` key — when the command (or, a
 * later clustering run) triggers it concurrently.
 */
export interface SingleFlightHolder<T> {
  in_flight?: Promise<T>;
}

/**
 * Run `operation` under the holder's single-flight latch, returning the
 * in-flight promise to any caller that arrives while it is running.
 */
export function single_flight<T>(
  holder: SingleFlightHolder<T>,
  operation: () => Promise<T>,
): Promise<T> {
  if (holder.in_flight) {
    return holder.in_flight;
  }
  holder.in_flight = operation().finally(() => {
    holder.in_flight = undefined;
  });
  return holder.in_flight;
}
