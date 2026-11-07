// Stands in for `cloudflare:workers` under Node: the DurableObject base class only keeps ctx and env.
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
