// One full-screen set piece at a time (#31): the Herald's auto-played lead, live Clashes and Introductions,
// Hall replays and a pushed story all queue for one stage, first come first served, so two cards never
// play over each other. Pure, so it's tested in apps/web/test; `OnStage.tsx` is the React side.

export class Stage {
  private readonly queue: string[] = [];
  private readonly listeners = new Set<() => void>();

  /** Who is playing now, or null. */
  current(): string | null {
    return this.queue[0] ?? null;
  }

  /** Joins the queue (once). */
  request(id: string): void {
    if (!this.queue.includes(id)) this.queue.push(id);
    this.emit();
  }

  /** Leaves the stage, or the queue if still waiting. */
  release(id: string): void {
    const at = this.queue.indexOf(id);
    if (at < 0) return;
    this.queue.splice(at, 1);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/** The app's one stage. */
export const stage = new Stage();
