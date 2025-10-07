// backend/routes/message.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { OpenAI } = require("openai");

const router = express.Router();
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

const promptPath = path.join(__dirname, "..", "prompts", "vitisense-system.txt");
const systemPrompt = {
  role: "system",
  content: fs.readFileSync(promptPath, "utf-8"),
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/messages (texto + imagen + contexto)
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const text = req.body.text || "";
    const rawHistory = req.body.history || "[]";
    const history = JSON.parse(rawHistory);
    const imageUrl = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`
      : null;

    // Montar mensajes para OpenAI
    const messages = [
      systemPrompt,
      ...history.map((msg) => ({
        role: msg.sender === "user" ? "user" : "assistant",
        content: msg.text,
      })),
    ];

    // Añadir mensaje actual (texto + imagen)
    if (imageUrl) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      });
    } else {
      messages.push({ role: "user", content: text });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      max_tokens: 1000,
    });

    const answer = completion.choices[0].message.content;
    res.json({ success: true, response: answer, imageUrl: imageUrl || null });
  } catch (err) {
    console.error("❌ Error en /api/messages:", err);
    res.status(500).json({ success: false, message: "Error en la consulta GPT-4o" });
  }
});

module.exports = router;