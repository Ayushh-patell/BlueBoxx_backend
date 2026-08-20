# BlueBoxx Admin Portal

Simple React/Vite admin UI for managing users and orders against the BlueBoxx backend.

## Run

1. Start the backend from the repo root (`npm run dev` — port `4000`).
2. In `frontend/`:

```bash
npm install
npm run dev
```

Open http://localhost:5173 — Vite proxies `/api` to `http://localhost:4000`.

## Sign in

- Use any existing app user credentials (`POST /api/user/login`).
- Enter `CREATE_USER_SECRET` as the admin secret so user list/create/update works.

## Features

- **Dashboard** — weekly/monthly order totals for a site
- **Users** — list, search, create, and update users
- **Orders** — view by day or range, open detail, update status

## Backend endpoints used / added

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/user/login` | existing |
| GET | `/api/user/list` | **new** — requires admin secret |
| POST | `/api/user/create` | existing |
| PATCH | `/api/user/update` | **new** — requires admin secret |
| GET | `/api/site` | **new** — list local sites |
| GET | `/api/order/by-site/day` | existing |
| GET | `/api/order/by-site/range` | existing |
| GET | `/api/order/dashboard` | existing |
| PATCH | `/api/order/:id/status` | existing |

Admin secret can be sent as `x-admin-secret` header, body `secret`, or query `secret`.
