'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;
let dbPath = null;

/**
 * Initialize the SQLite database using sql.js (pure JS, no native deps).
 * Loads existing DB from disk if present, otherwise creates a new one.
 * @param {string} filePath - Absolute path to the .db file
 * @returns {Promise<object>} The sql.js database instance
 */
async function initDatabase(filePath) {
  dbPath = filePath;
  const SQL = await initSqlJs();

  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    db = new SQL.Database(buffer);
    console.log('Loaded existing database from:', filePath);
  } else {
    db = new SQL.Database();
    console.log('Created new database at:', filePath);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      api_key TEXT,
      access_token TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT,
      stream_url TEXT,
      player_url TEXT,
      session_id TEXT,
      duration INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      insights TEXT,
      insights_status TEXT DEFAULT 'pending'
    );
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_recordings_session_id ON recordings(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_users_access_token ON users(access_token)');

  saveToFile();
  return db;
}

/**
 * Persist the in-memory database to disk.
 */
function saveToFile() {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('Error saving database to disk:', err);
  }
}

/**
 * Close the database and save to disk.
 */
function closeDatabase() {
  if (db) {
    saveToFile();
    db.close();
    db = null;
  }
}

/**
 * Get the raw database instance.
 */
function getDatabase() {
  return db;
}

// --- Helpers ---

/**
 * Convert sql.js result set to array of row objects.
 */
function resultToRows(result) {
  if (!result || result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

/**
 * Run a SELECT and return first row as object, or undefined.
 */
function getOne(sql, params = []) {
  const result = db.exec(sql, params);
  const rows = resultToRows(result);
  return rows[0] || undefined;
}

/**
 * Run a SELECT and return all rows as array of objects.
 */
function getAll(sql, params = []) {
  const result = db.exec(sql, params);
  return resultToRows(result);
}

// --- User queries ---

function findUserByToken(accessToken) {
  return getOne('SELECT * FROM users WHERE access_token = ?', [accessToken]);
}

function findUserById(id) {
  return getOne('SELECT * FROM users WHERE id = ?', [id]);
}

function createUser(name, apiKey, accessToken) {
  db.run('INSERT INTO users (name, api_key, access_token) VALUES (?, ?, ?)', [name, apiKey, accessToken]);
  const row = getOne('SELECT last_insert_rowid() as id');
  saveToFile();
  return { id: row.id, name, api_key: apiKey, access_token: accessToken };
}

function findUserByApiKey(apiKey) {
  return getOne('SELECT * FROM users WHERE api_key = ?', [apiKey]);
}

function getLatestUser() {
  return getOne('SELECT * FROM users ORDER BY id DESC LIMIT 1');
}

// --- Recording queries ---

function createRecording(data) {
  db.run(
    `INSERT INTO recordings (video_id, stream_url, player_url, session_id, duration, insights, insights_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.video_id || null,
      data.stream_url || null,
      data.player_url || null,
      data.session_id || null,
      data.duration || null,
      data.insights || null,
      data.insights_status || 'pending',
    ]
  );
  const row = getOne('SELECT last_insert_rowid() as id');
  saveToFile();
  return { id: row.id, ...data };
}

function findRecordingBySessionId(sessionId) {
  return getOne('SELECT * FROM recordings WHERE session_id = ?', [sessionId]);
}

function findRecordingByVideoId(videoId) {
  return getOne('SELECT * FROM recordings WHERE video_id = ?', [videoId]);
}

function updateRecording(id, data) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  db.run(`UPDATE recordings SET ${fields.join(', ')} WHERE id = ?`, values);
  saveToFile();
}

function getRecordings(limit = 20) {
  return getAll('SELECT * FROM recordings ORDER BY created_at DESC LIMIT ?', [limit]);
}

function getRecordingById(id) {
  return getOne('SELECT * FROM recordings WHERE id = ?', [id]);
}

module.exports = {
  initDatabase,
  closeDatabase,
  getDatabase,
  saveToFile,
  findUserByToken,
  findUserById,
  findUserByApiKey,
  getLatestUser,
  createUser,
  createRecording,
  findRecordingBySessionId,
  findRecordingByVideoId,
  updateRecording,
  getRecordings,
  getRecordingById,
};
