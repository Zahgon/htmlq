import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/htmlq.js', import.meta.url));

export function htmlq(args, input = '') {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    input: Buffer.from(input, 'utf8'),
    encoding: 'buffer',
  });
  return {
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8'),
    status: result.status,
  };
}

export function stdoutOf(args, input = '') {
  const { stdout, status, stderr } = htmlq(args, input);
  if (status !== 0) {
    throw new Error(`htmlq exited ${status}: ${stderr}`);
  }
  return stdout;
}
