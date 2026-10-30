// The clock (D39): every minute, POST the tick endpoint with the shared secret. Nothing else, so the
// Worker stays far inside the free plan's 10 ms CPU budget. The tick function ticks every world.

export interface Env {
  /** e.g. https://<project>.supabase.co/functions/v1/tick */
  TICK_URL: string;
  TICK_SECRET: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      fetch(env.TICK_URL, { method: 'POST', headers: { authorization: `Bearer ${env.TICK_SECRET}` } }).then(
        (res) => res.body?.cancel(),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
