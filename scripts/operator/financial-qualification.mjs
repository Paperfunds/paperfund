import fs from 'node:fs';
import dgram from 'node:dgram';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withReadonlyDatabase } from './treasury.mjs';
import { json, saveEvidence, hash } from './common.mjs';
const epoch = 2208988800;
function ntpMs(b, o) {
  return (b.readUInt32BE(o) - epoch) * 1000 + (b.readUInt32BE(o + 4) * 1000) / 4294967296;
}
export function decodeNtp(packet, request, { startWall, endWall, elapsedMs }) {
  if (
    packet.length < 48 ||
    packet[0] >> 6 === 3 ||
    (packet[0] & 7) !== 4 ||
    packet[1] < 1 ||
    packet[1] > 15 ||
    !packet.subarray(24, 32).equals(request.subarray(40, 48))
  )
    throw Error('UTC_NTP_RESPONSE_INVALID');
  const t2 = ntpMs(packet, 32),
    t3 = ntpMs(packet, 40),
    delay = elapsedMs - (t3 - t2),
    offset = (t2 - startWall + (t3 - endWall)) / 2;
  if (delay < -2 || Math.abs(endWall - startWall - elapsedMs) > 5 || !Number.isFinite(offset))
    throw Error('UTC_CLOCK_DISCONTINUITY_OR_INVALID_DELAY');
  if(ntpMs(packet,40)<ntpMs(packet,32))throw Error('UTC_NTP_SERVER_TIMESTAMP_ORDER');
  const rootDelayMs = (packet.readInt32BE(4) * 1000) / 65536,
    dispersionMs = (packet.readUInt32BE(8) * 1000) / 65536;
  if (rootDelayMs < 0) throw Error('UTC_NTP_ROOT_DELAY_INVALID');
  return {
    stratum: packet[1],
    rootDelayMs,
    dispersionMs,
    roundTripMs: elapsedMs,
    networkDelayMs: Math.max(delay, 0),
    offsetMs: offset,
    sourceAndAsymmetryBoundMs: rootDelayMs / 2 + dispersionMs + Math.max(delay, 0) / 2 + 2,
    authenticated: false,
  };
}
export async function sampleNtp(server) {
  const socket = dgram.createSocket('udp4'),
    request = Buffer.alloc(48);
  request[0] = 0x23;
  const wall = Date.now(),
    sec = wall / 1000 + epoch;
  request.writeUInt32BE(Math.floor(sec), 40);
  request.writeUInt32BE(Math.floor((sec % 1) * 4294967296), 44);
  const start = performance.now();
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('UTC_NTP_TIMEOUT')), 3500);
      socket.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      socket.once('message', (packet, remote) => {
        clearTimeout(timer);
        try {
          resolve({
            server,
            address: remote.address,
            port: remote.port,
            at: new Date().toISOString(),
            ...decodeNtp(packet, request, {
              startWall: wall,
              endWall: Date.now(),
              elapsedMs: performance.now() - start,
            }),
            requestBase64: request.toString('base64'),
            responseSha256: hash(packet),
            responseBase64: packet.toString('base64'),
          });
        } catch (e) {
          reject(e);
        }
      });
      socket.connect(123,server,()=>socket.send(request));
    });
  } finally {
    socket.close();
  }
}
export function assessUtc(windows, ntp, database) {
  const parse = (name) => {
    const m = windows.match(new RegExp(name + ':\\s*(-?[0-9.]+)s'));
    return m ? Number(m[1]) * 1000 : null;
  };
  const rootDelayMs = parse('Root Delay'),
    rootDispersionMs = parse('Root Dispersion'),
    phaseOffsetMs = parse('Phase Offset'),
    rootDistanceMs =
      rootDelayMs === null || rootDispersionMs === null ? null : rootDelayMs / 2 + rootDispersionMs;
  const reasons = [];
  if (rootDistanceMs === null) reasons.push('WINDOWS_TIME_BOUND_UNAVAILABLE');
  else if (rootDistanceMs > 100) reasons.push('WINDOWS_ROOT_DISTANCE_EXCEEDS_100MS');
  if (phaseOffsetMs === null || Math.abs(phaseOffsetMs) > 100)
    reasons.push('WINDOWS_PHASE_OFFSET_EXCEEDS_100MS_OR_UNAVAILABLE');
  if (!ntp.some((s) => s.authenticated === true))
    reasons.push('AUTHENTICATED_INDEPENDENT_SOURCE_REQUIRED');
  reasons.push('APPROVED_HOLDOVER_DRIFT_BOUND_REQUIRED', 'CONTINUOUS_CUTOFF_COVERAGE_REQUIRED');
  if (!database || database.error) reasons.push('DATABASE_CLOCK_BRACKET_UNAVAILABLE');
  else if(!Number.isFinite(database.conservativeBoundMs)||database.conservativeBoundMs>100)reasons.push('DATABASE_CLOCK_BRACKET_EXCEEDS_100MS_OR_INVALID');
  const independentBounds=ntp.filter(s=>Number.isFinite(s.offsetMs)&&Number.isFinite(s.sourceAndAsymmetryBoundMs)).map(s=>({server:s.server,hostUtcErrorBoundMs:Math.abs(s.offsetMs)+s.sourceAndAsymmetryBoundMs}));
  if(independentBounds.some(s=>s.hostUtcErrorBoundMs>100))reasons.push('INDEPENDENT_HOST_UTC_ERROR_BOUND_EXCEEDS_100MS');
  return {
    qualification: 'UNQUALIFIED',
    maximumUtcUncertaintyMs: 100,
    windows: { rootDelayMs, rootDispersionMs, rootDistanceMs, phaseOffsetMs },
    independentBounds,
    database,
    ntp,
    reasons,
  };
}
export async function captureQualification() {
  let windows = '';
  try {
    windows = (
      await promisify(execFile)('w32tm.exe', ['/query', '/status', '/verbose'], {
        windowsHide: true,
        timeout: 10000,
      })
    ).stdout;
  } catch {
    /* The qualification report explicitly retains unavailable clock evidence. */
  }
  const ntp = await Promise.all(
    ['time.cloudflare.com', 'time.google.com'].map(async (server) => {
      try {
        return await sampleNtp(server);
      } catch (e) {
        return {
          server,
          error: /^UTC_[A-Z_]+$/.test(e.message) ? e.message : 'UTC_NTP_UNAVAILABLE',
        };
      }
    }),
  );
  let database;
  try {
    const start = Date.now(),
      mono = performance.now(),
      r = await withReadonlyDatabase(
        async (c) =>
          (await c.query('select extract(epoch from clock_timestamp())*1000 utc_ms')).rows[0],
      );
    const end = Date.now(),
      v = Number(r.utc_ms);
    database = {
      at: new Date().toISOString(),
      roundTripMs: performance.now() - mono,
      offsetLowMs: v - end,
      offsetHighMs: v - start,
      conservativeBoundMs: Math.max(Math.abs(v - end), Math.abs(v - start)) + 1,
    };
  } catch {
    database = { error: 'DATABASE_CLOCK_BRACKET_UNAVAILABLE' };
  }
  const provider = JSON.parse(
    fs.readFileSync('artifacts/operator/reward-provider-latest.json', 'utf8'),
  );
  let attributed=null;try{attributed=JSON.parse(fs.readFileSync('artifacts/operator/winner-funding-latest.json','utf8')).assessment;}catch{/* Attribution is optional until captured. */}
  const result = {
    at: new Date().toISOString(),
    financialAuthority: 'NONE',
    readOnly: true,
    utc: assessUtc(windows, ntp, database),
    provider: {
      observedAt: provider.observedAt,
      bothCurrentlyAvailable:
        provider.bothAvailable && Date.now() - Date.parse(provider.observedAt) < 300000,
      latestContextSlots: provider.providers.map((p) => ({
        identity: p.identity,
        slot: p.accounts?.context?.slot,
        available: p.available,
      })),
      liveContextSlotDifferenceIsNotAnOutage: true,
      qualification: provider.qualification,
      retainedTokenEarningHistory:attributed?{status:attributed.status,earnedTokenLamports:attributed.earnedTokenLamports,claimedAggregateLamports:attributed.claimedAggregateLamports,databaseCredited:false}:null,
      blockers: [
        'RETAINED_PRE_CUTOFF_CAPTURE_MISSING',
        'POOL_UNIVERSE_COMPLETENESS_NOT_CERTIFIED',
        'NO_ACCEPTED_TOKEN_ATTRIBUTED_TREASURY_RECEIPT',
        ...(attributed?.reasons??[]),
      ],
      receivedTokenAttributedLamports: provider.verifiedReceivedCreatorFeeLamports,
    },
  };
  const saved = await saveEvidence('automation-qualification', result);
  fs.writeFileSync(
    'artifacts/operator/automation-qualification-latest.json',
    json({ ...result, evidence: saved }),
  );
  console.log(json({ ...result, evidence: saved }));
}
if (process.argv[1]?.endsWith('financial-qualification.mjs')) await captureQualification();
