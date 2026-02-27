require('dotenv').config();
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let pool;
let sqliteDb;
const isPostgres = process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes('user:password') &&
  !process.env.DATABASE_URL.includes('your_postgres');

if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('Detected environment: PostgreSQL');
} else {
  const dbPath = path.resolve(__dirname, 'academia.db');
  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Error opening SQLite', err);
    else console.log('Detected environment: SQLite');
  });
}

const db = {
  // Universal query method
  query: (text, params = [], callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }

    if (isPostgres) {
      // PostgreSQL native query
      if (callback) {
        pool.query(text, params, (err, res) => {
          if (res) {
            res.lastID = res.rows && res.rows[0] ? res.rows[0].id : null;
          }
          callback(err, res);
        });
      } else {
        return pool.query(text, params).then(res => {
          if (res.rows && res.rows[0]) res.lastID = res.rows[0].id;
          return res;
        });
      }
    } else {
      // SQLite wrapper
      return new Promise((resolve, reject) => {
        const isSelect = text.trim().toUpperCase().startsWith('SELECT');
        if (isSelect) {
          sqliteDb.all(text, params, (err, rows) => {
            const result = { rows: rows || [], rowCount: rows ? rows.length : 0 };
            if (callback) callback(err, result);
            if (err) reject(err); else resolve(result);
          });
        } else {
          sqliteDb.run(text, params, function (err) {
            const result = { rows: [], rowCount: this.changes, lastID: this.lastID, insertId: this.lastID };
            if (callback) callback(err, result);
            if (err) reject(err); else resolve(result);
          });
        }
      });
    }
  }
};

// Initialize Schema
async function initDb() {
  const idType = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const schema = [
    `CREATE TABLE IF NOT EXISTS users (
            id ${idType},
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            google_id TEXT,
            role TEXT,
            academy_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS academies (
            id ${idType},
            name TEXT NOT NULL,
            owner_id INTEGER,
            teacher_code TEXT,
            student_code TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS messages (
            id ${idType},
            academy_id INTEGER,
            room_id INTEGER,
            sender_id INTEGER,
            content TEXT,
            file_url TEXT,
            file_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read BOOLEAN DEFAULT FALSE
        )`,
    `CREATE TABLE IF NOT EXISTS rooms (
            id ${idType},
            academy_id INTEGER,
            type TEXT,
            name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS room_members (
            id ${idType},
            room_id INTEGER,
            user_id INTEGER
        )`,
    `CREATE TABLE IF NOT EXISTS students (
            id ${idType},
            academy_id INTEGER,
            assigned_teacher_id INTEGER,
            user_id INTEGER,
            name TEXT NOT NULL,
            course TEXT,
            subject TEXT,
            status TEXT DEFAULT 'active',
            join_date TEXT,
            parent_email TEXT,
            parent_phone TEXT
        )`,
    `CREATE TABLE IF NOT EXISTS sessions (
            id ${idType},
            student_id INTEGER,
            date TEXT,
            duration_minutes INTEGER,
            homework_done BOOLEAN,
            teacher_notes TEXT
        )`,
    `CREATE TABLE IF NOT EXISTS exams (
            id ${idType},
            student_id INTEGER,
            date TEXT,
            subject TEXT,
            score REAL
        )`,
    `CREATE TABLE IF NOT EXISTS payments (
            id ${idType},
            student_id INTEGER,
            amount REAL,
            due_date TEXT,
            paid_date TEXT,
            status TEXT DEFAULT 'pending'
        )`,
    `CREATE TABLE IF NOT EXISTS reports (
            id ${idType},
            student_id INTEGER,
            academy_id INTEGER,
            month INTEGER,
            year INTEGER,
            file_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`
  ];

  for (const sql of schema) {
    try {
      await db.query(sql);
    } catch (err) {
      console.error('Init Table Error:', err.message);
    }
  }

  if (!isPostgres) {
    // Safe column additions for SQLite only
    await db.query("ALTER TABLE students ADD COLUMN academy_id INTEGER").catch(() => { });
    await db.query("ALTER TABLE students ADD COLUMN assigned_teacher_id INTEGER").catch(() => { });
    await db.query("ALTER TABLE students ADD COLUMN user_id INTEGER").catch(() => { });
  }

  // Default settings
  try {
    const settingsRes = await db.query("SELECT COUNT(*) as count FROM settings");
    const count = isPostgres ? parseInt(settingsRes.rows[0].count) : settingsRes.rows[0].count;
    if (count === 0) {
      const defaults = [
        ['academy_name', 'AcademiaPro'],
        ['contact_email', 'info@academiapro.com'],
        ['contact_phone', '+34 600 000 000'],
        ['contact_address', 'Calle Falsa 123, Madrid'],
        ['report_name', 'Academia Profesional'],
        ['report_footer', 'Gracias por confiar en nosotros.'],
        ['report_signature', 'El Director'],
        ['notify_risk', 'false'],
        ['notify_payment', 'false'],
        ['notify_monthly', 'false']
      ];
      for (const [key, val] of defaults) {
        const insertSql = isPostgres
          ? "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING"
          : "INSERT OR IGNORE INTO settings (key, value) VALUES ($1, $2)";
        await db.query(insertSql, [key, val]);
      }
    }
  } catch (e) { console.error('Settings Init Error', e); }
}

initDb();

module.exports = db;
