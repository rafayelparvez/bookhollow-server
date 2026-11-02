# AGENTS.md

Guidance for agents working in this repository.

## Project Overview

`bookhollow - server` is the backend API for the BookHollow project. It is a small
Express 5 server (ES modules) that connects to MongoDB Atlas and currently exposes
two endpoints.

## Layout

- `index.js` — the entire application: Express app, MongoDB client, routes, and
  `app.listen`. There are no `src/`, `routes/`, `controllers/`, or `models/`
  directories yet.
- `package.json` — ESM project (`"type": "module"`), dependencies: `express`,
  `mongodb`, `cors`, `dotenv`.
- `.env` — holds `MONGODB_URI` (git-ignored; never commit or print its contents).
- `node_modules/` — installed dependencies (git-ignored).

## Running

```bash
npm install
npm run dev     # nodemon, auto-restarts on file changes
npm start       # plain node, no reload
```

- Server listens on `http://localhost:8000`.
- The port is hardcoded as `PORT` in `index.js`.
- `nodemon` is a devDependency. Use `npm run dev` while developing — `npm start`
  does not reload, so an edited file will not take effect until a manual restart
  (a stale process silently serving old code is a known trap here).
- There is no test suite (`npm test` just exits 1).

## Endpoints

- `GET /` → `{ message: 'Server running successfully' }`
- `POST /add-book` → `{ message: 'Api working....' }` (placeholder; does not touch the
  database yet)

## Conventions and Notes

- Use ES module syntax (`import`/`export`), not `require`.
- Environment variables are loaded with `import 'dotenv/config'` at the top of
  `index.js`; keep that import first.
- MongoDB connection is centralized in `connectToMongoDB()`, which reuses a single
  module-level `MongoClient` instance. Follow that pattern rather than creating new
  clients per request.
- CORS is enabled globally with `app.use(cors())`.
- No JSON body parser is registered yet — add `express.json()` if an endpoint needs
  a request body.
- No linter, formatter, or type checker is configured. Code style is 2-space
  indentation, single quotes, no semicolons on most lines (matches existing file).
- There is no authentication, validation layer, or error-handling middleware.

## Git

- `.env` and `node_modules/` must stay untracked (see `.gitignore`).
