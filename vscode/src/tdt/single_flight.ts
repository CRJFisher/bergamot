/**
 * Keeps the TDT embed pass single: one model load, no two passes racing writes
 * to the same `topic_page_vector` key when the command and a clustering run
 * trigger it concurrently. The latch clears on settle (success or failure) so a
 * transient failure does not wedge all future calls onto a cached rejection.
 */
export interface SingleFlightHolder<T> {
  in_flight?: Promise<T>;
}

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
