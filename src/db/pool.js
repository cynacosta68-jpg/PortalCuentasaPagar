'use strict';
const { Pool } = require('pg');

// Todas las tablas del portal viven en el schema `portal` para no colisionar
// con otras apps que compartan la misma base (p. ej. TuFacturador en public).
// El search_path se puede sobreescribir con DB_SCHEMA si hiciera falta.
const DB_SCHEMA = process.env.DB_SCHEMA || 'portal';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  options: `-c search_path=${DB_SCHEMA},public`,
});

pool.on('error', (err) => console.error('[db] error inesperado en cliente idle:', err));

module.exports = pool;
