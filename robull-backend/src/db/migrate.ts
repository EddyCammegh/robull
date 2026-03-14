import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

// Works both in dev (src/db/) and production (dist/db/) because schema.sql
// stays in src/db/ on Railway and we resolve from the project root.
const schemaPath = path.resolve(process.cwd(), 'src/db/schema.sql');

export async function runMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Running migrations...');
  try {
    await pool.query(sql);
    console.log('Migrations complete.');
  } finally {
    await pool.end();
  }
}

// Allow running directly: tsx src/db/migrate.ts
if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
