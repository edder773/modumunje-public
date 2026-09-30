// @ts-check
/**
 * Serializes writes for each key and coalesces rapid changes to the latest
 * value. Failed values remain pending and can be retried without reordering.
 *
 * @template K, V
 * @param {(key: K, value: V) => Promise<void>} write
 */
export function createLatestValueQueue(write) {
  /** @type {Map<K, { value: V, version: number, persistedVersion: number, running?: Promise<void> }>} */
  const lanes = new Map();

  /** @param {K} key */
  function drain(key) {
    const lane = lanes.get(key);
    if (!lane) return Promise.resolve();
    if (lane.running) return lane.running;

    const run = async () => {
      while (lane.persistedVersion < lane.version) {
        const version = lane.version;
        const value = lane.value;
        await write(key, value);
        lane.persistedVersion = version;
      }
    };
    const pending = run().finally(() => {
      if (lane.running === pending) lane.running = undefined;
      if (lanes.get(key) === lane && lane.persistedVersion === lane.version) lanes.delete(key);
    });
    lane.running = pending;
    return pending;
  }

  return {
    /** @param {K} key @param {V} value */
    enqueue(key, value) {
      const lane = lanes.get(key) ?? {
        value,
        version: 0,
        persistedVersion: 0,
      };
      lane.value = value;
      lane.version += 1;
      lanes.set(key, lane);
      return drain(key);
    },
    /** @param {K} key */
    retry(key) {
      return drain(key);
    },
    /** @param {K} key */
    hasPending(key) {
      const lane = lanes.get(key);
      return Boolean(lane && lane.persistedVersion < lane.version);
    },
    /** @param {K} key */
    clear(key) {
      lanes.delete(key);
    },
  };
}
