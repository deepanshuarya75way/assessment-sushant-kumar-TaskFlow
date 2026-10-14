import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.resolve('data/taskflow-test.db');
fs.rmSync(testDb, { force: true });
process.env.DATABASE_FILE = testDb;
process.env.SESSION_SECRET = 'test-only-session-secret';
const { default: app } = await import('../src/app.js');
const { db, closeDb } = await import('../src/db.js');

describe('TaskFlow authentication and ownership API', () => {
  const alice = request.agent(app);
  const bob = request.agent(app);
  let aliceTaskId;

  afterAll(() => { closeDb(); fs.rmSync(testDb, { force: true }); });

  it('reports health and rejects protected access without a session', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/tasks')).status).toBe(401);
    expect((await request(app).get('/api/stats')).status).toBe(401);
  });

  it('validates signup, registers a user, hashes the password, and preserves seeded tasks', async () => {
    expect((await request(app).post('/api/auth/signup').send({ fullName: 'A', email: 'bad', password: 'short' })).status).toBe(400);
    const response = await alice.post('/api/auth/signup').send({ fullName: 'Alice Morgan', email: 'Alice@Example.com', password: 'correct horse battery staple' });
    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ fullName: 'Alice Morgan', email: 'alice@example.com' });
    expect(response.body.user.password_hash).toBeUndefined();
    const stored = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('alice@example.com');
    expect(stored.password_hash).not.toBe('correct horse battery staple');
    expect(stored.password_hash.startsWith('$2')).toBe(true);
    await alice.post('/api/auth/login').send({ email: 'alice@example.com', password: 'correct horse battery staple' });
    expect((await alice.get('/api/tasks')).body.length).toBe(3);
  });

  it('rejects duplicate emails', async () => {
    const response = await request(app).post('/api/auth/signup').send({ fullName: 'Another Alice', email: 'alice@example.com', password: 'another password' });
    expect(response.status).toBe(409);
  });

  it('logs in with the correct password and rejects incorrect credentials', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'wrong password' })).status).toBe(401);
    const response = await alice.post('/api/auth/login').send({ email: 'alice@example.com', password: 'correct horse battery staple' });
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('alice@example.com');
    expect((await alice.get('/api/auth/me')).body.user.fullName).toBe('Alice Morgan');
  });

  it('creates, reads, filters, updates, and deletes only owned tasks', async () => {
    const created = await alice.post('/api/tasks/').send({ title: 'Alice task', description: 'Private work', status: 'Todo', priority: 'High', dueDate: '2099-01-01' });
    expect(created.status).toBe(201);
    aliceTaskId = created.body.id;
    expect((await alice.get(`/api/tasks/${aliceTaskId}`)).body.title).toBe('Alice task');
    expect((await alice.get('/api/tasks?search=private&status=Todo&priority=High')).body.some((task) => task.id === aliceTaskId)).toBe(true);
    expect((await alice.put(`/api/tasks/${aliceTaskId}`)).status).toBe(400);
    const updated = await alice.put(`/api/tasks/${aliceTaskId}`).send({ title: 'Updated Alice task', description: '', status: 'Done', priority: 'Low', dueDate: '2099-01-02' });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('Done');
    expect((await alice.get('/api/stats')).body.total).toBe(4);

    await bob.post('/api/auth/signup').send({ fullName: 'Bob Stone', email: 'bob@example.com', password: 'bob secure password' });
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: 'bob secure password' });
    expect((await bob.get(`/api/tasks/${aliceTaskId}`)).status).toBe(404);
    expect((await bob.put(`/api/tasks/${aliceTaskId}`).send({ title: 'hijack', description: '', status: 'Todo', priority: 'Low', dueDate: '2099-01-03' })).status).toBe(404);
    expect((await bob.delete(`/api/tasks/${aliceTaskId}`)).status).toBe(404);
    expect((await alice.delete(`/api/tasks/${aliceTaskId}`)).status).toBe(204);
  });

  it('logs out and invalidates the session', async () => {
    expect((await alice.post('/api/auth/logout')).status).toBe(204);
    expect((await alice.get('/api/auth/me')).status).toBe(401);
    expect((await alice.get('/api/tasks')).status).toBe(401);
  });
});
