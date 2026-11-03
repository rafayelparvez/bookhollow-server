# 📚 BookHollow API

The Express backend for [BookHollow](https://bookhollow.vercel.app), a small online library.
It stores books and borrow records in MongoDB and trusts users who sign in through Better Auth on the Next.js frontend.

[![API](https://img.shields.io/badge/live-bookhollow--server.vercel.app-blue?style=flat-square)](https://bookhollow-server.vercel.app)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-404D59?style=flat-square&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)

---

## ✨ What it does

- CRUD for books, with **owner-only** edit and delete
- Borrow and return books (14-day loans, one copy per user per book)
- Verifies JWTs issued by **Better Auth** using its public JWKS (no shared secret needed)
- Accepts cover images as an `http(s)` link or a base64 data URL
- Never exposes owner emails in public responses

---

## 🧱 Stack

| Purpose | Package |
|---|---|
| Web framework | `express` |
| Database | `mongodb` |
| JWT verification | `jose` |
| CORS | `cors` |
| Env loading | `dotenv` |

The project uses ES modules, so `package.json` needs `"type": "module"`.

---

## 🔐 How authentication works

1. The user signs in on the Next.js app (Better Auth).
2. The frontend gets a JWT and sends it as `Authorization: Bearer <token>`.
3. This server verifies the token against `AUTH_URL/api/auth/jwks`, checking the signature, issuer and audience (both must equal `AUTH_URL`).
4. The verified identity is placed on `req.user` as `{ uid, email, name }`. The request body is **never** trusted for identity.

`jose` caches the public keys and re-fetches them automatically if the signing key rotates.

---

## 🚀 Getting started

### Prerequisites

- Node.js 18+
- A MongoDB database (Atlas or local)
- The BookHollow frontend running, since it hosts the Better Auth JWKS endpoint

### Install and run

```bash
npm install
npm start          # or: node server.js
```

Default address: `http://localhost:8000`

### Environment variables

Create a `.env` file:

```env
# URL of the Next.js app where Better Auth runs.
# Must match BETTER_AUTH_URL on the frontend exactly (no trailing slash needed).
AUTH_URL=http://localhost:3000

MONGODB_URI=<your mongodb connection string>
MONGODB_DB=library        # optional, defaults to "library"
PORT=8000                 # optional, defaults to 8000
```

The server throws on startup if `AUTH_URL` or `MONGODB_URI` is missing.

### CORS

Allowed origins are set in `corsOptions` at the top of `server.js`:

```js
origin: ["https://bookhollow.vercel.app", "http://localhost:3000"]
```

Add your own domain there if you deploy the frontend somewhere else.

---

## 🔌 API reference

Protected routes require `Authorization: Bearer <token>`.

### Health

| Method | Endpoint | Auth | Response |
|---|---|---|---|
| `GET` | `/` | Public | `{ "message": "Server running successfully" }` |

### Books

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/books` | Public | All books, newest first. `addedBy.email` is removed |
| `GET` | `/books/:id` | Required | One book. Email is shown only to the owner |
| `POST` | `/books` | Required | Create a book |
| `PATCH` | `/books/:id` | Owner only | Update any of the fields below |
| `DELETE` | `/books/:id` | Owner only | Delete a book and its borrow records |

**Book fields**

| Field | Type | Notes |
|---|---|---|
| `title` | string | Required on create |
| `author` | string | Required on create |
| `category` | string | Defaults to `"Fiction"` |
| `copies` | integer | Required on create, at least 1 |
| `description` | string | Optional |
| `image` / `imageUrl` | string | `http(s)` URL or `data:image/(png\|jpg\|jpeg\|webp\|gif);base64,...`. Either field name works |

When editing `copies`, the server keeps `availableCopies` consistent and refuses to go below the number of copies currently on loan. Sending an empty image keeps the existing one.

**Example**

```bash
curl -X POST http://localhost:8000/books \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "The Hobbit",
    "author": "J.R.R. Tolkien",
    "category": "Fantasy",
    "copies": 3,
    "description": "Bilbo Baggins joins an unexpected adventure.",
    "image": "https://example.com/cover.jpg"
  }'
```

### Borrows

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/borrows` | Required | Borrow a book. Body: `{ "bookId": "<24-char id>" }` |
| `GET` | `/borrows` | Required | The current user's borrows, newest first |
| `DELETE` | `/borrows/:id` | Required | Return a book. Only your own borrows |

Borrowing takes one copy atomically (`availableCopies` decrements only if it is above 0), so two people can't grab the last copy at once.

---

## 🗄️ Data model

**`books`**

```json
{
  "_id": "ObjectId",
  "title": "string",
  "author": "string",
  "category": "string",
  "description": "string",
  "totalCopies": 3,
  "availableCopies": 2,
  "image": "string | null",
  "addedBy": { "id": "string", "name": "string", "email": "string" },
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**`borrows`**

```json
{
  "_id": "ObjectId",
  "bookId": "string",
  "bookTitle": "string",
  "bookImage": "string | null",
  "userName": "string",
  "userEmail": "string",
  "borrowDate": "Date",
  "returnDate": "Date"
}
```

On startup the server creates a **unique index** on `borrows { bookId, userEmail }`, so one user can never hold the same book twice, even with simultaneous requests. If old duplicate records exist, the index can't be built; the server logs a warning and keeps running, and you can clean up the duplicates and restart.

---

## ⚠️ Errors

Errors are returned as `{ "message": "..." }`.

| Code | Meaning |
|---|---|
| `400` | Validation failed, invalid id, or nothing to update |
| `401` | Token missing, invalid or expired |
| `403` | You don't own this book |
| `404` | Book or borrow record not found |
| `409` | Already borrowed, or no copies available |
| `413` | Request body (image) too large. The limit is 5 MB |
| `500` | Server error. Details are logged, not sent to the client |

---

## 🧪 Quick check

```bash
API=http://localhost:8000

curl -i $API/books                                           # 200, public
curl -i $API/borrows                                         # 401, token missing
curl -i $API/borrows -H "Authorization: Bearer abc.def.ghi"  # 401, invalid token
curl -i -X DELETE $API/books/123                             # 401
```

To test ownership, sign in with two different accounts and try to `PATCH` or `DELETE` a book owned by the other one. You should get `403`.

---

## ☁️ Deploying to Vercel

1. Add the environment variables above in the Vercel project settings.
2. Set `AUTH_URL` to your deployed frontend URL.
3. Make sure that URL is in the CORS `origin` list.
4. Redeploy after changing any variable.

`server.js` exports the Express `app` for serverless use and also calls `listen()` for local development.

---

## 🛡️ Security notes

- Every write needs a verified JWT, and identity comes only from the token.
- Book edit and delete are limited to the owner.
- Public responses hide email addresses.
- IDs are validated as strict 24-character hex strings.
- Inputs are coerced to strings before use, so odd payloads return `400` instead of crashing.
- Internal error messages are not leaked on `5xx`.
- `X-Powered-By` is disabled.

---

## 👤 Author

**Parvez Mosharaf**: designed and built the BookHollow API.

Part of [BookHollow](https://bookhollow.vercel.app), a small online library.