// A Node module hook for the World DO's tests: `cloudflare:workers` resolves to a stand-in base class, so
// world.ts loads under node --test. Registered by workerd.ts.
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: new URL('./cloudflare-workers.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
