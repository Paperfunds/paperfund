import { Redis } from "./node_modules/ioredis/built/index.js";
function createRedis(redisUrl) {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1
  });
  client.on("error", () => {
  });
  return {
    async healthCheck() {
      try {
        if (client.status === "wait") {
          await client.connect();
        }
        return await client.ping() === "PONG";
      } catch {
        return false;
      }
    },
    async get(key) {
      return client.get(key);
    },
    async setExpiring(key, value, ttlSeconds) {
      await client.set(key, value, "EX", ttlSeconds);
    },
    async take(key) {
      const result = await client.eval(
        "local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]) end; return v",
        1,
        key
      );
      return typeof result === "string" ? result : null;
    },
    async delete(key) {
      await client.del(key);
    },
    async incrementWindow(key, ttlSeconds) {
      const result = await client.eval(
        "local v=redis.call('INCR',KEYS[1]); if v==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return v",
        1,
        key,
        ttlSeconds
      );
      return Number(result);
    },
    async close() {
      if (client.status === "end") {
        return;
      }
      if (client.status === "wait") {
        client.disconnect();
        return;
      }
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  };
}
export {
  createRedis
};
