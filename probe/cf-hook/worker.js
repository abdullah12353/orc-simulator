// Throwaway relay for #57: Neon Auth refuses webhook URLs on Neon infrastructure, so this Worker
// forwards each delivery (headers + body) to the Neon Function catcher. Delete after the probe.
const TARGET = "https://br-red-moon-bax2hhng-hook.compute.c-8.eu-central-1.aws.neon.tech";
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const r = await fetch(TARGET + url.pathname, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : await req.text() });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  },
};
