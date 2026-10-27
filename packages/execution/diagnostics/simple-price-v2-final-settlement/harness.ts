import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRedis } from '../../../../apps/api/src/redis.js';
import { ReplayHarness } from '../simple-price-v2-settlement/harness.js';
import { IsolatedHighWater } from '../../candidates/simple-price-v2-directional/high-water.js';
import { join } from 'node:path';
import type { SelectionPolicy } from './archive.js';
import { CutoffArchive, SELECTION_VERSION } from './archive.js';
export const TEST_POLICY: SelectionPolicy = {
  version: SELECTION_VERSION,
  maxAgeMs: 5000,
  rationale:
    'Controlled compatibility boundary only: unchanged execution fixture ceiling; not evidence of approved live freshness',
  provenance: 'CONTROLLED_ARCHIVED_REPLAY_ONLY' as const,
};
export class FinalHarness extends ReplayHarness {
  archive!: CutoffArchive;
  private redisId = '';
  private readonly redisToken = randomUUID();
  override async start() {
    this.redisId = execFileSync(
      'docker',
      [
        'run',
        '--detach',
        '--rm',
        '--pull=never',
        '--label',
        'paperfund.v2.final-review=' + this.redisToken,
        '--publish',
        '127.0.0.1::6379',
        '--tmpfs',
        '/data:rw,size=64m',
        'redis:8-alpine',
        'redis-server',
        '--save',
        '',
        '--appendonly',
        'no',
      ],
      { encoding: 'utf8' },
    ).trim();
    const info = JSON.parse(
      execFileSync('docker', ['inspect', this.redisId], { encoding: 'utf8' }),
    )[0];
    const port = info.NetworkSettings.Ports['6379/tcp'][0];
    if (
      port.HostIp !== '127.0.0.1' ||
      info.Mounts.some((m: { Type: string }) => ['bind', 'volume'].includes(m.Type))
    )
      throw Error('DISPOSABLE_REDIS_ISOLATION_REQUIRED');
    const redis = createRedis('redis://127.0.0.1:' + port.HostPort);
    Object.assign(this.redis, redis);
    if (!(await this.redis.healthCheck())) throw Error('DISPOSABLE_REDIS_NOT_READY');
    await super.start();
    this.archive = new CutoffArchive(
      this.database,
      this.token,
      this.policy,
      TEST_POLICY,
      () => this.now.getTime(),
      new IsolatedHighWater(join(this.directory, 'pre-cutoff-ingestion'), this.policy),
    );
    await this.archive.initialize();
  }
  private removeOwnedRedis() {
    if (this.redisId) {
      const info = JSON.parse(
        execFileSync('docker', ['inspect', this.redisId], { encoding: 'utf8' }),
      )[0];
      if (
        info.Id !== this.redisId ||
        info.Config.Labels['paperfund.v2.final-review'] !== this.redisToken
      )
        throw Error('OWNED_REDIS_GUARD_REQUIRED');
      execFileSync('docker', ['rm', '--force', this.redisId], { stdio: 'ignore' });
      this.redisId = '';
    }
  }
  override async close() {
    try {
      await super.close();
    } finally {
      this.removeOwnedRedis();
    }
  }
}
