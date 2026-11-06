import { readFileSync } from "node:fs";
const file = process.env.ENV_FILE ?? "C:/Users/abdul/.t3/projects/orc-simulator/.env.deploy";
export const env = Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1")]; }));
