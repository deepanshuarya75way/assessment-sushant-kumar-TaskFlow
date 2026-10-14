import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from './db.js';
import { parseLoginInput, parseSignupInput, parseTaskInput } from './validation.js';

const app = express();
const sessionCookie = 'taskflow_session';
const sessionDays = Math.max(1, Number(process.env.SESSION_DAYS || 7));
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || null;
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((origin) => origin.trim());
if (!allowedOrigins.includes('http://127.0.0.1:5173')) allowedOrigins.push('http://127.0.0.1:5173');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const toUser = (row) => row && ({ id: row.id, fullName: row.full_name, email: row.email, createdAt: row.created_at });
const toTask = (row) => row && ({ ...row, dueDate: row.due_date, createdAt: row.created_at, updatedAt: row.updated_at });
const selectUserByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
const selectUserById = db.prepare('SELECT * FROM users WHERE id = ?');

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: sessionDays * 24 * 60 * 60 * 1000, path: '/' };
}

function sessionKey(token) {
  const hash = sessionSecret ? crypto.createHmac('sha256', sessionSecret) : crypto.createHash('sha256');
  return hash.update(token).digest('hex');
}

function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(sessionKey(token), userId, expiresAt);
  res.cookie(sessionCookie, token, cookieOptions());
}

function getSessionUser(req) {
  const token = req.cookies[sessionCookie];
  if (!token) return null;
  const session = db.prepare("SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(sessionKey(token));
  if (!session) return null;
  return selectUserById.get(session.user_id) || null;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  return next();
}

function clearSession(req, res) {
  const token = req.cookies[sessionCookie];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(sessionKey(token));
  res.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/' });
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'taskflow-api' }));

app.post('/api/auth/signup', (req, res) => {
  const input = parseSignupInput(req.body);
  if (selectUserByEmail.get(input.email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const passwordHash = bcrypt.hashSync(input.password, 12);
  const result = db.prepare('INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)').run(input.fullName, input.email.toLowerCase(), passwordHash);
  // Preserve pre-auth tasks by assigning them to the first account created.
  if (userCount === 0) db.prepare('UPDATE tasks SET user_id = ? WHERE user_id IS NULL').run(result.lastInsertRowid);
  res.status(201).json({ user: toUser(selectUserById.get(result.lastInsertRowid)) });
});

app.post('/api/auth/login', (req, res) => {
  const input = parseLoginInput(req.body);
  const user = selectUserByEmail.get(input.email);
  if (!user || !bcrypt.compareSync(input.password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  createSession(user.id, res);
  res.json({ user: toUser(user) });
});

app.post('/api/auth/logout', (req, res) => { clearSession(req, res); res.status(204).send(); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: toUser(req.user) }));

app.get('/api/tasks', requireAuth, (req, res) => {
  const { search = '', status = '', priority = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
  const allowedSort = { created_at: 'created_at', due_date: 'due_date' };
  const sortColumn = allowedSort[sortBy] || 'created_at';
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const params = { userId: req.user.id, search: `%${String(search).trim()}%` };
  const where = ['user_id = @userId', '(title LIKE @search OR description LIKE @search)'];
  if (['Todo', 'In Progress', 'Done'].includes(status)) { where.push('status = @status'); params.status = status; }
  if (['Low', 'Medium', 'High'].includes(priority)) { where.push('priority = @priority'); params.priority = priority; }
  const rows = db.prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY ${sortColumn} ${direction}, id DESC`).all(params);
  res.json(rows.map(toTask));
});

app.get('/api/tasks/:id', requireAuth, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.json(toTask(task));
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const input = parseTaskInput(req.body);
  const result = db.prepare(`INSERT INTO tasks (user_id, title, description, status, priority, due_date) VALUES (@userId, @title, @description, @status, @priority, @dueDate)`).run({ ...input, userId: req.user.id });
  res.status(201).json(toTask(db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, req.user.id)));
});

app.put('/api/tasks/:id', requireAuth, (req, res) => {
  if (!db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id)) return res.status(404).json({ error: 'Task not found' });
  const input = parseTaskInput(req.body);
  db.prepare(`UPDATE tasks SET title=@title, description=@description, status=@status, priority=@priority, due_date=@dueDate, updated_at=CURRENT_TIMESTAMP WHERE id=@id AND user_id=@userId`).run({ ...input, id: Number(req.params.id), userId: req.user.id });
  res.json(toTask(db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id)));
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Task not found' });
  res.status(204).send();
});

app.get('/api/stats', requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE user_id = ?').get(req.user.id).count;
  const completed = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status = 'Done'").get(req.user.id).count;
  const pending = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status != 'Done'").get(req.user.id).count;
  const overdue = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status != 'Done' AND due_date < date('now')").get(req.user.id).count;
  res.json({ total, completed, pending, overdue, completionPercentage: total ? Math.round((completed / total) * 100) : 0 });
});

app.use((_req, _res, next) => { const error = new Error('Route not found'); error.status = 404; next(error); });
app.use((error, _req, res, _next) => {
  if (!error.status || error.status >= 500) console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error' });
});

export default app;
