'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DB_SCHEMA = process.env.DB_SCHEMA || 'portal';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${DB_SCHEMA},public`,
});

async function migrate() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  // El schema debe existir antes que cualquier tabla (incluido _migraciones),
  // porque el search_path apunta a él. No toca el schema public de otras apps.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${DB_SCHEMA}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migraciones (
      archivo TEXT PRIMARY KEY,
      aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migraciones WHERE archivo = $1', [file]);
    if (rows.length > 0) {
      console.log(`[migrate] ya aplicada: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO _migraciones (archivo) VALUES ($1)', [file]);
    console.log(`[migrate] aplicada: ${file}`);
  }

  await pool.end();
  console.log('[migrate] listo');
}

migrate().catch(err => { console.error(err); process.exit(1); });
