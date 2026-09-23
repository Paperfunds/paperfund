import { Redis } from 'ioredis';

export interface RedisService {
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export function createRedis(redisUrl: string): RedisService {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  client.on('error', () => {
    // Connection failures are surfaced through readiness without logging credentials.
  });

  return {
    async healthCheck() {
      try {
        if (client.status === 'wait') {
          await client.connect();
        }
        return (await client.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
    async close() {
      if (client.status === 'end') {
        return;
      }
      if (client.status === 'wait') {
        client.disconnect();
        return;
      }
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}
