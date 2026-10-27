import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../../db/src/database.js';
import type { DatabaseService } from '../../../db/src/database.js';

/** Never reads DATABASE_URL/.env; owns a fresh server, no shared production volume or fixed port. */
export class DisposableDatabase {
  private id: string | null = null;
  private directory: string | null = null;
  database: DatabaseService | undefined;
  readonly token = randomUUID();
  readonly label = 'paperfund.v2.integration';
  async start(): Promise<{ database: DatabaseService; directory: string; token: string }> {
    this.directory = await mkdtemp(join(tmpdir(), 'paperfund-simple-v2-integration-'));
    const name = 'paperfund-v2-fixture-' + randomUUID();
    const password = randomBytes(24).toString('hex');
    this.id = execFileSync(
      'docker',
      [
        'run',
        '--detach',
        '--rm',
        '--pull=never',
        '--name',
        name,
        '--label',
        this.label + '=' + this.token,
        '--publish',
        '127.0.0.1::5432',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,size=512m',
        '--env',
        'POSTGRES_USER=paperfund_fixture',
        '--env',
        'POSTGRES_DB=paperfund_v2_disposable',
        '--env',
        'POSTGRES_PASSWORD=' + password,
        'postgres:17-alpine',
      ],
      { encoding: 'utf8' },
    ).trim();
    const info = JSON.parse(execFileSync('docker', ['inspect', this.id], { encoding: 'utf8' })) as {
      Id: string;
      Config: { Labels: Record<string, string> };
      NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[]> };
      Mounts: { Type: string }[];
    }[];
    const server = info[0]!,
      port = server.NetworkSettings.Ports['5432/tcp']?.[0];
    if (
      server.Id !== this.id ||
      server.Config.Labels[this.label] !== this.token ||
      !port ||
      port.HostIp !== '127.0.0.1' ||
      server.Mounts.some((m) => m.Type === 'bind' || m.Type === 'volume')
    )
      throw new Error('DISPOSABLE_SERVER_ISOLATION_FAILED');
    this.database = createDatabase(
      'postgresql://paperfund_fixture:' +
        password +
        '@127.0.0.1:' +
        port.HostPort +
        '/paperfund_v2_disposable',
    );
    let healthy = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await this.database.healthCheck()) {
        healthy = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!healthy) throw new Error('DISPOSABLE_POSTGRES_NOT_READY');
    await migrate(this.database.client, { migrationsFolder: resolve('packages/db/migrations') });
    await this.database.pool.query(
      await readFile(new URL('./disposable-schema.sql', import.meta.url), 'utf8'),
    );
    await this.database.pool.query('insert into private_v2.isolation_guard(token) values($1)', [
      this.token,
    ]);
    // No signer, worker, reward funding or payout execution is installed in this process.
    return { database: this.database, directory: this.directory, token: this.token };
  }
  async close(): Promise<void> {
    if (this.database) {
      await this.database.close();
      this.database = undefined;
    }
    if (this.id) {
      const server = JSON.parse(
        execFileSync('docker', ['inspect', this.id], { encoding: 'utf8' }),
      ) as { Id: string; Config: { Labels: Record<string, string> } }[];
      if (server[0]?.Id !== this.id || server[0]?.Config.Labels[this.label] !== this.token)
        throw new Error('UNOWNED_CONTAINER_CLEANUP_REJECTED');
      execFileSync('docker', ['rm', '--force', this.id], { stdio: 'ignore' });
      this.id = null;
    }
    if (this.directory) {
      const target = resolve(this.directory),
        prefix = resolve(tmpdir()) + sep + 'paperfund-simple-v2-integration-';
      if (!target.startsWith(prefix)) throw new Error('UNSAFE_DISPOSABLE_CLEANUP');
      await rm(target, { recursive: true, force: true });
      this.directory = null;
    }
  }
}
