# Tip Tracker

A small, self-hosted web app for small teams to log daily tips, split them
transparently, and give every teammate a clean view of what they earned.

- **Transparent** — every employee can see the math for their share.
- **Fast to log** — pre-select who worked based on each person's weekly
  schedule, enter the total, done.
- **Portable** — single Node.js process, single SQLite file, Docker image
  under 150 MB. One-click backup.
- **Localised** — ships with English and Spanish, configurable currency and
  locale.

## Quickstart (Docker)

```bash
cp .env.example .env

# Generate a password hash and paste it into ADMIN_PASSWORD_HASH.
docker run --rm node:22-bookworm-slim npx -y bcryptjs --help # (or use the helper below)
node helpers/hash-password.js 'your-admin-password'           # requires local node

# Generate a random session secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up -d
```

Open <http://localhost:3000>.

## Quickstart (local Node)

```bash
npm install
npm start
# Visit http://localhost:3000
# Default dev admin password: coffee123
```

## Environment variables

| Var                    | Required | Default            | Description                                                             |
| ---------------------- | -------- | ------------------ | ----------------------------------------------------------------------- |
| `ADMIN_PASSWORD_HASH`  | prod     | —                  | bcrypt hash of the admin password. Generate with the helper.            |
| `SESSION_SECRET`       | prod     | random (dev only)  | Signing key for session cookies.                                        |
| `ADMIN_PASSWORD`       |          | `coffee123` (dev)  | Plain password fallback (hashed at startup). Ignored if hash is set.    |
| `PORT`                 |          | `3000`             | HTTP port.                                                              |
| `NODE_ENV`             |          | `development`      | `production` turns on secure cookies and strict checks.                 |
| `TRUST_PROXY`          |          | —                  | Hop count for `X-Forwarded-*` (e.g. `1` behind one reverse proxy).      |
| `CURRENCY`             |          | `USD`              | Display currency (ISO 4217).                                            |
| `LOCALE`               |          | `en-US`            | BCP-47 locale for number formatting.                                    |
| `TZ`                   |          | OS default         | Server timezone. The clock drives "today" and "this week".              |
| `DB_PATH`              |          | `./data/tips.db`   | Location of the SQLite file.                                            |
| `DEBUG`                |          | —                  | Any truthy value enables extra log output.                              |

## Features

- Public weekly view of tips, per employee.
- Admin console: record daily totals, apply the weekly schedule, override an
  individual's share, edit or delete past days (with undo).
- Cents-accurate math — $100 ÷ 3 stores as 33.34 / 33.33 / 33.33 (always
  sums back to the total).
- CSV export of history, filtered by date range.
- Streaming SQLite snapshot backup at `/admin/backup.sqlite`.
- English + Spanish UI with a language switcher.
- Dark-mode aware, responsive down to 320 px, keyboard-navigable modals.
- Audit log of every admin mutation at `/admin/audit`.

## Security

- Admin password stored as a bcrypt hash, compared in constant time.
- Sessions: HttpOnly, SameSite=Lax, Secure in production; regenerated on login.
- CSRF protection on every mutating endpoint (double-submit cookie).
- Rate limiting on login (10 / 15 min / IP) and write APIs (120 / min / IP).
- Strict Content-Security-Policy (no inline scripts, no third-party origins).
- `redirectTo` is validated to be a same-origin path; external URLs are ignored.
- Vulnerability audit: `npm audit` reports 0 high/critical.

## Operations

- **Backup.** `curl -H "Cookie: tt.sid=…; csrf_token=…" -X GET /admin/backup.sqlite -o backup.sqlite` downloads a streamable SQLite snapshot.
- **Restore.** Stop the process, replace `data/tips.db` with the backup file,
  start again.
- **Health check.** `GET /healthz` returns `{ ok: true, db_ms: <latency> }`.
  The Docker image uses this for its healthcheck.
- **Graceful shutdown.** `SIGTERM` / `SIGINT` drain in-flight requests and
  close the database before exiting.
- **Logs.** One JSON-per-line record on stdout. Errors go to stderr.

## Development

```bash
npm run dev        # nodemon
npm test           # integration + unit tests (node:test + supertest)
npm run lint       # eslint
npm run format     # prettier --write
```

### Project layout

```
app.js              express entry + middleware wiring
database.js         SQLite schema + queries
routes/
  pages.js          HTML routes
  api.js            JSON API
  admin.js          admin-only routes
lib/
  auth.js           bcrypt + session helpers
  csrf.js           double-submit cookie
  dates.js          all timezone-safe date math
  money.js          cents ↔ display, split helpers
  validation.js     input guards
  logger.js         JSON logger + request-id
  i18n.js           locale picker + `t()` helper
  undo.js           ephemeral delete snapshots
locales/en.json, locales/es.json
views/              EJS templates
public/             styles, js, icons sprite
test/               node:test specs
```

## Licence

MIT — see `LICENSE`.
