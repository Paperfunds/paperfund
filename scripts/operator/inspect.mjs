import { captureDiscovery, prepareClaim } from './discovery.mjs';
import { json, saveEvidence } from './common.mjs';
try {
  const discovery = await captureDiscovery();
  const plan = await prepareClaim(discovery);
  console.log(
    json({
      discovery,
      unsignedClaim: plan,
      planEvidence: await saveEvidence('unsigned-claim', plan),
    }),
  );
} catch {
  console.error(
    'Read-only discovery/preparation failed; inspect retained local evidence. No transaction signed or sent.',
  );
  process.exitCode = 1;
}
