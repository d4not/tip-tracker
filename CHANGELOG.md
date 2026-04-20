# Changelog

## 3.0.0

- **Security hardening**: bcrypt-hashed admin password, CSRF (double-submit),
  helmet with a strict CSP, rate limits, `redirectTo` validation, session
  regeneration on login, structured JSON logging, `/healthz`, graceful
  shutdown, audit log of admin mutations.
- **Money as cents**: all amounts stored as integers. Splits are
  cents-accurate (sum always matches the total).
- **Per-employee overrides**: set an individual share; the remainder splits
  evenly across the rest.
- **Undo delete**: a short window to restore an employee or tip day after
  deletion.
- **Intuitive frontend**: public landing page, role-aware top nav,
  Lucide-style inline SVG icon set, dark-mode-aware palette, responsive
  card view under 640 px, focus trap in modals, keyboard shortcuts.
- **i18n**: English + Spanish, selectable from the nav.
- **Ops**: Dockerfile + docker-compose, `.env.example`, helper CLI to hash a
  password, README with full environment reference.
- **Split code**: `app.js` → `routes/*.js` + `lib/*.js`. ESLint + Prettier.
  `npm audit` reports 0 vulnerabilities.

## 2.0.0

- Translated project to English. Added shared stylesheet, modern palette,
  toast notifications, history CSV export, basic rate limiting, validation.

## 1.0.0

- Initial Spanish-language release.
