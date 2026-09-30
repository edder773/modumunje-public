// @ts-check
/** Invalidates UI continuations without undoing an already accepted server write. */
export function createSessionEpoch() {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    capture() {
      const captured = generation;
      return () => captured === generation;
    },
  };
}
