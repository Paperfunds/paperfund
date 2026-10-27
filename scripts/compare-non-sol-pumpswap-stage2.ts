import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { workingVectors } from '../packages/protocols/test/fixtures/stage2-working-vectors.js';
const file = new URL(
    '../packages/protocols/test/fixtures/non-sol-stage2-before.json',
    import.meta.url,
  ),
  data = await workingVectors();
if (process.argv.includes('--capture-before')) {
  if (existsSync(file)) throw Error('Refusing to overwrite before vectors');
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('Captured seven fixed-state working branches before integration');
} else {
  if (!isDeepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), data))
    throw Error('OFF route parity differs');
  console.log(
    'OFF parity: all seven branches identical in raw units, fees, capacity, identity and rejection.',
  );
}
