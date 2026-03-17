import 'dotenv/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { syncMarkets } from '../cron/syncMarkets.js';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await redis.connect();

  // ── Before counts ──
  const { rows: before } = await pool.query(
    `SELECT category, COUNT(*)::int AS count
     FROM markets WHERE resolved = false
     GROUP BY category ORDER BY count DESC`
  );
  console.log('\n=== BEFORE RESYNC ===');
  let totalBefore = 0;
  for (const r of before) {
    console.log(`  ${r.category.padEnd(15)} ${r.count}`);
    totalBefore += r.count;
  }
  console.log(`  ${'TOTAL'.padEnd(15)} ${totalBefore}`);

  // ── Run full sync ──
  console.log('\n=== RUNNING FULL SYNC ===');
  await syncMarkets(pool, redis);

  // ── After counts ──
  const { rows: after } = await pool.query(
    `SELECT category, COUNT(*)::int AS count
     FROM markets WHERE resolved = false
     GROUP BY category ORDER BY count DESC`
  );
  console.log('\n=== AFTER RESYNC ===');
  let totalAfter = 0;
  for (const r of after) {
    const prev = before.find(b => b.category === r.category)?.count ?? 0;
    const diff = r.count - prev;
    const diffStr = diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : '';
    console.log(`  ${r.category.padEnd(15)} ${r.count}${diffStr}`);
    totalAfter += r.count;
  }
  const totalDiff = totalAfter - totalBefore;
  const totalDiffStr = totalDiff > 0 ? ` (+${totalDiff})` : totalDiff < 0 ? ` (${totalDiff})` : '';
  console.log(`  ${'TOTAL'.padEnd(15)} ${totalAfter}${totalDiffStr}`);

  await redis.quit();
  await pool.end();
}

main().catch((err) => {
  console.error('Force resync failed:', err);
  process.exit(1);
});
