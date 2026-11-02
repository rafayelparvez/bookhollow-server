import express from "express";
import { MongoClient } from "mongodb";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = 8000;

app.use(cors());
// The cover image may arrive as a base64 string inside the JSON body,
// so the limit must be higher than Express's 100 kb default.
app.use(express.json({ limit: "5mb" }));

// ---------- MongoDB ----------
const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db(process.env.MONGODB_DB ?? "library");
const books = db.collection("books");

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

// ---------- Routes ----------
app.get("/", (req, res) => {
  res.send({ message: "Server running successfully" });
});

app.post("/add-book", async (req, res, next) => {
  try {
    const {
      title,
      author,
      category,
      copies,
      description,
      image, // optional: base64 data URL from a file upload
      imageUrl, // optional: link to an image hosted elsewhere
      userId,
      userName,
      userEmail,
    } = req.body;

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
      // Uploaded file wins if both are sent. Either way, `image`
      // can be used directly in <img src>.
      image: image || trimmedImageUrl || null,
      addedBy: { id: userId, name: userName, email: userEmail },
      createdAt: new Date(),
    };

    const result = await books.insertOne(book);

    res.status(201).send({
      message: "Book added successfully.",
      id: result.insertedId,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/books", async (req, res, next) => {
  try {
    const list = await books.find().sort({ createdAt: -1 }).toArray();
    res.send(list);
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