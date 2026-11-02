import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT ?? 8000;
const LOAN_DAYS = 14;

app.use(cors());
// Cover images may arrive as base64 strings, so raise the 100 kb default.
app.use(express.json({ limit: "5mb" }));

// ---------- Better Auth JWT verification ----------
// AUTH_URL = the URL of your Next.js app where Better Auth runs
// (must match BETTER_AUTH_URL exactly, e.g. http://localhost:3000).
const AUTH_URL = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
// Public keys published by Better Auth's jwt() plugin. jose caches them
// and re-fetches automatically if the signing key rotates.
const JWKS = createRemoteJWKSet(new URL(`${AUTH_URL}/api/auth/jwks`));

// ---------- MongoDB ----------
const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db(process.env.MONGODB_DB ?? "library");
const books = db.collection("books");
const borrows = db.collection("borrows");

// ---------- Helpers ----------
const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const isImageDataUrl = (value) =>
  /^data:image\/(png|jpe?g|webp|gif);base64,/.test(value);

const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---------- Middleware ----------
// Token check: expects "Authorization: Bearer <ID token>".
// On success, the verified identity is on req.user (never trust the body for it).
async function verifyToken(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return res.status(401).send({ message: "Unauthorized: token missing." });
  }

  try {
    // Better Auth sets issuer and audience to the auth base URL by default.
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: AUTH_URL,
      audience: AUTH_URL,
    });
    if (!payload.email) {
      return res.status(401).send({ message: "Unauthorized: no email on token." });
    }
    req.user = {
      uid: String(payload.sub ?? payload.id ?? ""),
      email: String(payload.email),
      name: String(payload.name ?? ""),
    };
    next();
  } catch {
    res.status(401).send({ message: "Unauthorized: invalid or expired token." });
  }
}

function validId(req, res, next) {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ message: "Invalid id." });
  }
  next();
}

// ---------- Health ----------
app.get("/", (req, res) => {
  res.send({ message: "Server running successfully" });
});

// =====================================================
// BOOKS
// =====================================================

// 1. GET /books — public
app.get("/books", async (req, res, next) => {
  try {
    const list = await books.find().sort({ createdAt: -1 }).toArray();
    res.send(list);
  } catch (error) {
    next(error);
  }
});

// 2. GET /books/:id — protected
app.get("/books/:id", verifyToken, validId, async (req, res, next) => {
  try {
    const book = await books.findOne({ _id: new ObjectId(req.params.id) });
    if (!book) return res.status(404).send({ message: "Book not found." });
    res.send(book);
  } catch (error) {
    next(error);
  }
});

// 3. POST /books — protected
app.post("/books", verifyToken, async (req, res, next) => {
  try {
    const { title, author, category, copies, description, image, imageUrl } =
      req.body;

    if (!title?.trim() || !author?.trim()) {
      return res
        .status(400)
        .send({ message: "Book title and author name are required." });
    }

    const totalCopies = Number.parseInt(copies, 10);
    if (!Number.isInteger(totalCopies) || totalCopies < 1) {
      return res
        .status(400)
        .send({ message: "Total copies must be a whole number of at least 1." });
    }

    if (image && !isImageDataUrl(String(image))) {
      return res
        .status(400)
        .send({ message: "Image must be a PNG, JPG, WEBP or GIF file." });
    }

    const trimmedImageUrl = imageUrl?.trim();
    if (trimmedImageUrl && !isHttpUrl(trimmedImageUrl)) {
      return res
        .status(400)
        .send({ message: "Image URL must start with http:// or https://." });
    }

    const book = {
      title: title.trim(),
      author: author.trim(),
      category: category || "Fiction",
      description: description?.trim() || "",
      totalCopies,
      availableCopies: totalCopies,
      image: image || trimmedImageUrl || null,
      addedBy: {
        id: req.user.uid,
        name: req.user.name,
        email: req.user.email,
      },
      createdAt: new Date(),
    };

    const result = await books.insertOne(book);
    res
      .status(201)
      .send({ message: "Book added successfully.", id: result.insertedId });
  } catch (error) {
    next(error);
  }
});

// 4. PATCH /books/:id — protected
app.patch("/books/:id", verifyToken, validId, async (req, res, next) => {
  try {
    const _id = new ObjectId(req.params.id);
    const existing = await books.findOne({ _id });
    if (!existing) return res.status(404).send({ message: "Book not found." });

    const { title, author, category, description, copies, image, imageUrl } =
      req.body;
    const update = {};

    if (title !== undefined) {
      if (!String(title).trim()) {
        return res.status(400).send({ message: "Title cannot be empty." });
      }
      update.title = String(title).trim();
    }

    if (author !== undefined) {
      if (!String(author).trim()) {
        return res.status(400).send({ message: "Author cannot be empty." });
      }
      update.author = String(author).trim();
    }

    if (category !== undefined) update.category = category;
    if (description !== undefined) update.description = String(description).trim();

    if (image) {
      if (!isImageDataUrl(String(image))) {
        return res
          .status(400)
          .send({ message: "Image must be a PNG, JPG, WEBP or GIF file." });
      }
      update.image = image;
    } else if (imageUrl !== undefined) {
      const trimmed = String(imageUrl).trim();
      if (trimmed && !isHttpUrl(trimmed)) {
        return res
          .status(400)
          .send({ message: "Image URL must start with http:// or https://." });
      }
      if (trimmed) update.image = trimmed;
    }

    if (copies !== undefined) {
      const newTotal = Number.parseInt(copies, 10);
      const onLoan = existing.totalCopies - existing.availableCopies;
      if (!Number.isInteger(newTotal) || newTotal < 1) {
        return res
          .status(400)
          .send({ message: "Total copies must be a whole number of at least 1." });
      }
      if (newTotal < onLoan) {
        return res.status(400).send({
          message: `${onLoan} cop${onLoan === 1 ? "y is" : "ies are"} currently borrowed, so total copies can't go below ${onLoan}.`,
        });
      }
      update.totalCopies = newTotal;
      update.availableCopies = newTotal - onLoan;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).send({ message: "Nothing to update." });
    }

    update.updatedAt = new Date();
    const updated = await books.findOneAndUpdate(
      { _id },
      { $set: update },
      { returnDocument: "after" },
    );
    res.send({ message: "Book updated successfully.", book: updated });
  } catch (error) {
    next(error);
  }
});

// 5. DELETE /books/:id — protected
app.delete("/books/:id", verifyToken, validId, async (req, res, next) => {
  try {
    const _id = new ObjectId(req.params.id);
    const result = await books.deleteOne({ _id });
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Book not found." });
    }
    // Remove dangling borrow records for the deleted book.
    await borrows.deleteMany({ bookId: req.params.id });
    res.send({ message: "Book deleted successfully." });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// BORROWS
// =====================================================

// 6. POST /borrows — protected. Body: { bookId }
app.post("/borrows", verifyToken, async (req, res, next) => {
  try {
    const { bookId } = req.body;
    if (!ObjectId.isValid(bookId)) {
      return res.status(400).send({ message: "A valid bookId is required." });
    }

    const { email, name } = req.user;

    const already = await borrows.findOne({ bookId, userEmail: email });
    if (already) {
      return res
        .status(409)
        .send({ message: "You have already borrowed this book." });
    }

    // Atomically take one copy; matches nothing if none are left.
    const book = await books.findOneAndUpdate(
      { _id: new ObjectId(bookId), availableCopies: { $gt: 0 } },
      { $inc: { availableCopies: -1 } },
      { returnDocument: "after" },
    );

    if (!book) {
      const exists = await books.findOne({ _id: new ObjectId(bookId) });
      return res.status(exists ? 409 : 404).send({
        message: exists ? "No copies available right now." : "Book not found.",
      });
    }

    const borrowDate = new Date();
    const returnDate = new Date(
      borrowDate.getTime() + LOAN_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      const result = await borrows.insertOne({
        bookId,
        bookTitle: book.title,
        bookImage: book.image ?? null,
        userName: name,
        userEmail: email,
        borrowDate,
        returnDate,
      });
      res
        .status(201)
        .send({ message: "Book borrowed successfully.", id: result.insertedId });
    } catch (err) {
      // Give the copy back if the borrow couldn't be saved.
      await books.updateOne({ _id: book._id }, { $inc: { availableCopies: 1 } });
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

// 7. GET /borrows — protected; only the logged-in user's borrows
app.get("/borrows", verifyToken, async (req, res, next) => {
  try {
    const list = await borrows
      .find({ userEmail: req.user.email })
      .sort({ borrowDate: -1 })
      .toArray();
    res.send(list);
  } catch (error) {
    next(error);
  }
});

// 8. DELETE /borrows/:id — protected; return a book
app.delete("/borrows/:id", verifyToken, validId, async (req, res, next) => {
  try {
    const record = await borrows.findOneAndDelete({
      _id: new ObjectId(req.params.id),
      userEmail: req.user.email, // users can only return their own borrows
    });
    if (!record) {
      return res.status(404).send({ message: "Borrow record not found." });
    }

    await books.updateOne(
      { _id: new ObjectId(record.bookId) },
      { $inc: { availableCopies: 1 } },
    );
    res.send({ message: "Book returned successfully." });
  } catch (error) {
    next(error);
  }
});

// ---------- Error handler ----------
app.use((error, req, res, next) => {
  console.error(error);

  if (error.type === "entity.too.large") {
    return res.status(413).send({ message: "The uploaded image is too large." });
  }

  res
    .status(error.status ?? 500)
    .send({ message: error.message || "Something went wrong on the server." });
});

// ---------- Start ----------
async function start() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");

    app.listen(PORT, () => {
      console.log(`Server is running at ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();