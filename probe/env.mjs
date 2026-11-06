import { readFileSync } from "node:fs";
const file = process.env.ENV_FILE ?? "C:/Users/abdul/.t3/projects/orc-simulator/.env.deploy";
export const env = Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1")]; }));
// Several scripts drop and truncate tables: refuse to run against anything but the throwaway orc-probe project.
if (env.NEON_PROJECT_ID !== "gentle-unit-02894440") throw new Error(`env.mjs: NEON_PROJECT_ID is ${env.NEON_PROJECT_ID}, not orc-probe; refusing`);
