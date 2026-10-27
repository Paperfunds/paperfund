import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
function installDrain(directory, role, drain) {
  let busy = false;
  const request = join(directory, role + "-drain.request.json");
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const raw = JSON.parse(await readFile(request, "utf8"));
        assert(
          raw?.schema === "PAPERFUND_DRAIN_V1" && typeof raw.requestId === "string",
          "DRAIN_REQUEST"
        );
        clearInterval(timer);
        await drain();
        await mkdir(directory, { recursive: true });
        const target = join(directory, role + "-drained.json"), temp = target + "." + process.pid + ".tmp";
        await writeFile(
          temp,
          JSON.stringify({
            requestId: raw.requestId,
            pid: process.pid,
            drainedAt: (/* @__PURE__ */ new Date()).toISOString()
          }) + "\n"
        );
        await rename(temp, target);
      } catch (e) {
        if (e.code !== "ENOENT") console.error("DRAIN_REQUEST_REJECTED");
      } finally {
        busy = false;
      }
    })();
  }, 250);
  return () => clearInterval(timer);
}
export {
  installDrain
};
