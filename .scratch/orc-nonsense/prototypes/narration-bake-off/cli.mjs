// Argument parsing for run.mjs: [--mock] [--limit N]
export function parseArgs(argv) {
  const args = { mock: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mock') {
      args.mock = true;
    } else if (arg === '--limit') {
      const value = argv[++i];
      if (!/^[1-9]\d*$/.test(value ?? '')) throw new Error(`--limit needs a positive whole number, got ${value ?? 'nothing'}`);
      args.limit = Number(value);
    } else {
      throw new Error(`Unknown argument: ${arg}. Usage: node run.mjs [--mock] [--limit N]`);
    }
  }
  return args;
}
