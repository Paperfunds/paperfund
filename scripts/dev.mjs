import { spawn } from 'node:child_process';

const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function spawnWorkspace(workspace) {
  if (process.platform === 'win32') {
    return spawn(`npm run dev --workspace ${workspace}`, { stdio: 'inherit', shell: true });
  }
  return spawn(executable, ['run', 'dev', '--workspace', workspace], { stdio: 'inherit' });
}

const children = [
  spawnWorkspace('@paperfund/api'),
  spawnWorkspace('@paperfund/worker'),
  spawnWorkspace('@paperfund/web'),
];
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

for (const child of children) {
  child.once('exit', (code, signal) => {
    if (!stopping) {
      stop();
      process.exitCode = signal ? 1 : (code ?? 1);
    }
  });
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
