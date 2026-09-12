import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('../apps/api/', import.meta.url));
const compiler = require.resolve('typescript/bin/tsc');
const compileArgs = [compiler, '-p', 'tsconfig.build.json'];
const initial = spawnSync(process.execPath, compileArgs, { cwd, stdio: 'inherit' });
if (initial.status !== 0) process.exit(initial.status ?? 1);

const compilerProcess = spawn(
  process.execPath,
  [...compileArgs, '--watch', '--preserveWatchOutput'],
  { cwd, stdio: 'inherit' },
);
const apiProcess = spawn(process.execPath, ['--env-file=../../.env', '--watch', 'dist/main.js'], {
  cwd,
  stdio: 'inherit',
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  compilerProcess.kill('SIGTERM');
  apiProcess.kill('SIGTERM');
}
for (const child of [compilerProcess, apiProcess]) {
  child.once('error', () => stop(1));
  child.once('exit', (code) => stop(code ?? 0));
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
