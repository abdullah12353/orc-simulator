// Which answers a loading tab may show. Each load asks `begin()` for a ticket and shows its answer only if
// `accept(ticket)` says so: never one asked before `reset()` (a world switch, or the tab closing), and
// never one older than an answer already shown. Pure, so it's tested in apps/web/test.

export interface LoadTicket {
  readonly epoch: number;
  readonly seq: number;
}

export interface LoadGate {
  begin(): LoadTicket;
  accept(ticket: LoadTicket): boolean;
  reset(): void;
}

export function loadGate(): LoadGate {
  let epoch = 0;
  let issued = 0;
  let shown = 0;
  return {
    begin: () => ({ epoch, seq: ++issued }),
    accept(t) {
      if (t.epoch !== epoch || t.seq < shown) return false;
      shown = t.seq;
      return true;
    },
    reset() {
      epoch += 1;
      shown = issued;
    },
  };
}
