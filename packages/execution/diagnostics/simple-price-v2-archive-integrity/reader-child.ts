import { Pool } from 'pg';
process.once('message', async (job: { url: string; round: string }) => {
  const pool = new Pool({ connectionString: job.url, max: 1 });
  try {
    const r = (await pool.query('select archive_integrity.read_seal($1) result', [job.round]))
      .rows[0].result;
    process.send?.({ digest: r.digest, body: r.body, status: r.status, durability: r.durability });
    await pool.end();
    process.exit(0);
  } catch {
    await pool.end();
    process.exit(76);
  }
});
