// A module hook for Seam B tests that run the PWA's own read code (apps/web/src) in Node: the app's
// `./supabase.ts` reads Vite's import.meta.env, so it's swapped for `./supabase-stub.ts`, a real
// supabase-js client the test signs in as a user. Everything else in apps/web/src runs unchanged.
const stub = new URL('./supabase-stub.ts', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === './supabase.ts' && context.parentURL?.includes('/apps/web/src/')) {
    return { url: stub, shortCircuit: true };
  }
  return next(specifier, context);
}
