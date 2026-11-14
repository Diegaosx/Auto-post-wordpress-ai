import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const connectionString = 'postgresql://postgres:REmnfizCzhNqUczBDMsCVcOAudVOBwKL@hopper.proxy.rlwy.net:50860/railway';
const schemaPath = path.resolve('src/server/db/postgres-schema.sql');

async function migrate() {
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const pool = new pg.Pool({ connectionString });

  try {
    console.log('Applying PostgreSQL schema migrations...');
    await pool.query(sql);
    console.log('Schema migration applied successfully!');

    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('Tables:');
    console.log(res.rows.map(r => r.table_name).join(', '));
  } finally {
    await pool.end();
  }
}

migrate().catch(console.error);
