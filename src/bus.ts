type Listener = (event: string) => void;

/**
 * Minimal in-process pub/sub. Backs both the SSE streams that push updates to
 * open browsers and the long-poll endpoint that lets Claude wait for a reply
 * without hammering the server.
 */
class Bus {
  #channels = new Map<string, Set<Listener>>();

  subscribe(channel: string, listener: Listener): () => void {
    let set = this.#channels.get(channel);
    if (!set) {
      set = new Set();
      this.#channels.set(channel, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.#channels.delete(channel);
    };
  }

  publish(channel: string, event = 'update'): void {
    for (const listener of this.#channels.get(channel) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must never take down the publisher.
      }
    }
  }

  /** Resolves true when the channel fires, false on timeout. */
  wait(channel: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      const unsubscribe = this.subscribe(channel, () => finish(true));
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export const bus = new Bus();
