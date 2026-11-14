import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const connectionString = 'postgresql://postgres:REmnfizCzhNqUczBDMsCVcOAudVOBwKL@hopper.proxy.rlwy.net:50860/railway';
const schemaPath = path.resolve('src/server/db/postgres-schema.sql');

async function migrate() {
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const pool = new pg.Pool({ connectionString });

  try {
    console.log('Resetting and migrating PostgreSQL schema...');
    await pool.query(`
      DROP TABLE IF EXISTS captured_articles CASCADE;
      DROP TABLE IF EXISTS news_sources CASCADE;
      DROP TABLE IF EXISTS wordpress_logs CASCADE;
      DROP TABLE IF EXISTS wordpress_sites CASCADE;
      DROP TABLE IF EXISTS metrics_daily CASCADE;
      DROP TABLE IF EXISTS audit_logs CASCADE;
      DROP TABLE IF EXISTS password_resets CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);
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
