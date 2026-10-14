# TaskFlow - Project & Task Management System

TaskFlow is a full-stack task-management MVP for a company hiring assessment. It uses React/Vite, Express, SQLite, bcrypt password hashing, and HttpOnly cookie sessions.

## Prerequisites

- Node.js 18 or newer (Node.js 20+ recommended)
- npm 9 or newer
- A modern browser

The backend uses `better-sqlite3`, a native Node module. On unusual platforms, use a Node version with a compatible prebuilt binary or the platform's normal native-build toolchain.

## Install and run

From the repository root (`D:\TaskFlow` on Windows):

```bash
npm run install:all
```

Start the API in Terminal 1:

```bash
npm run dev:backend
```

Start the Vite app in Terminal 2:

```bash
npm run dev:frontend
```

Open `http://localhost:5173`. The API runs at `http://localhost:4000`.

For a production frontend build:

```bash
npm run build
```

The default configuration works without environment files. To override it, copy the examples:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

Backend variables:

- `PORT` - API port; default `4000`
- `CLIENT_ORIGIN` - comma-separated allowed frontend origins; default `http://localhost:5173`
- `DATABASE_FILE` - SQLite path; default `backend/data/taskflow.db`
- `SESSION_SECRET` - placeholder for production deployments; cookie sessions use random opaque tokens, and this value is reserved for future signing/key rotation
- `SESSION_DAYS` - session lifetime in days; default `7`
- `NODE_ENV=production` - enables the `Secure` cookie flag; use HTTPS in production

Frontend variable:

- `VITE_API_URL` - API base URL; default `/api` in Vite development (proxied to `http://localhost:4000`); set an absolute API URL for a separately hosted frontend

## Architecture and authentication flow

```text
frontend/src/main.jsx  ->  frontend/src/api.js  ->  backend/src/app.js
                                                        |
                                                        v
                                             backend/src/db.js / SQLite
```

- `frontend/` contains Login/Signup screens, session restoration, logout, the protected dashboard, task modal, filters, responsive CSS, and the API client.
- `backend/` contains auth/task routes, Zod validation, bcrypt hashing, cookie sessions, CORS, ownership checks, migrations, and tests.
- Login creates a random opaque session token stored server-side in `sessions` and sent as an HttpOnly, SameSite=Lax cookie. The browser sends it using `credentials: include`.
- On refresh, the frontend calls `/api/auth/me`. Unauthenticated users see Login instead of the dashboard.
- Signup does not automatically create a session; it returns `201`, then the UI directs the user to Login.
- Task and stats routes require an authenticated session and always filter by `user_id` server-side.

## Database schema and migration

The repeatable initialization in `backend/src/db.js` creates or migrates:

| Table/column | Type | Notes |
| --- | --- | --- |
| `users.id` | INTEGER | Primary key |
| `users.full_name` | TEXT | Required |
| `users.email` | TEXT | Required, unique case-insensitively |
| `users.password_hash` | TEXT | bcrypt hash; never returned by API |
| `users.created_at` | TEXT | Creation timestamp |
| `sessions.token` | TEXT | Random opaque token, primary key |
| `sessions.user_id` | INTEGER | Foreign key to `users` |
| `sessions.expires_at` | TEXT | Expiration timestamp |
| `tasks.user_id` | INTEGER | Foreign key to `users`; added safely to existing databases |
| `tasks.id` | INTEGER | Existing task primary key |
| `tasks.title` | TEXT | Required, maximum 120 characters |
| `tasks.description` | TEXT | Maximum 2000 characters |
| `tasks.status` | TEXT | `Todo`, `In Progress`, or `Done` |
| `tasks.priority` | TEXT | `Low`, `Medium`, or `High` |
| `tasks.due_date` | TEXT | Required `YYYY-MM-DD` |
| `tasks.created_at` / `updated_at` | TEXT | SQLite timestamps |

Existing tasks are not deleted or reset. On the first signup, any legacy tasks with no owner are assigned to that first account so existing data remains available without being exposed to later accounts. A new empty database receives three `[Sample]` tasks.

## REST API

All routes use the `/api` prefix and return JSON unless noted.

### Authentication

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/auth/signup` | Validates and creates a user; returns `201` and safe user data |
| POST | `/api/auth/login` | Validates credentials, sets HttpOnly session cookie; returns `200` |
| POST | `/api/auth/logout` | Revokes the current session and clears the cookie; returns `204` |
| GET | `/api/auth/me` | Returns the current safe user or `401` |

Signup request:

```json
{
  "fullName": "Alex Morgan",
  "email": "alex@example.com",
  "password": "at-least-8-characters"
}
```

### Tasks and statistics

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/health` | API health check |
| GET | `/api/tasks` or `/api/tasks/` | Lists only the signed-in user's tasks; supports `search`, `status`, `priority`, `sortBy=created_at|due_date`, and `sortOrder=asc|desc` |
| GET | `/api/tasks/:id` | Returns one owned task or `404` |
| POST | `/api/tasks` or `/api/tasks/` | Creates an owned task; returns `201` |
| PUT | `/api/tasks/:id` | Updates an owned task; returns `200` or `404` |
| DELETE | `/api/tasks/:id` | Deletes an owned task; returns `204` or `404` |
| GET | `/api/stats` | Computes totals directly from the signed-in user's SQLite rows |

Validation failures return `400`; duplicate emails return `409`; invalid credentials and missing sessions return `401`; another user's task appears as `404`. Password hashes, session tokens, and secrets are never returned in API responses.

## Testing and verification

Run backend authentication, ownership, validation, CRUD, and persistence-oriented tests:

```bash
npm test
```

The test suite uses a temporary SQLite file and does not modify the development database. It verifies registration, duplicate email, invalid input, bcrypt hashing, incorrect password, login, `/me`, logout, unauthorized access, task ownership, filtering, CRUD, and database-backed stats.

Build the frontend:

```bash
npm run build
```

Manual flow:

1. Start both services.
2. Open `http://localhost:5173`.
3. Create an account on Signup.
4. Sign in on Login.
5. Create, edit, refresh, and delete a task.
6. Log out and confirm the dashboard is no longer accessible.

For assessment screenshots, capture the authenticated overview dashboard and the Login or Signup card using the browser screenshot tool or operating-system screenshot shortcut.

## Repository hygiene

`.gitignore` excludes `node_modules/`, frontend `dist/`, local `.env` files, SQLite database files, and coverage output. Commit source files, package manifests/lockfiles, `.env.example` files, tests, and this README. Do not commit secrets, local database files, `node_modules`, or generated build output.

## Explicitly out of scope

This MVP does not implement and must not be represented as implementing:

- Authentication providers beyond email/password
- Multi-user workspace administration, roles, or sharing
- Pagination
- Production deployment configuration, hosting, reverse proxy, HTTPS certificates, or CI/CD
- Password reset, email verification, MFA, file attachments, comments, activity history, or notifications
