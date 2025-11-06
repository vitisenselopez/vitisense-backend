const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { OpenAI } = require("openai");
const cloudinary = require("cloudinary").v2;

const router = express.Router();

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configurar multer (sin carpeta local, se borra tras subir)
const storage = multer.memoryStorage();
const upload = multer({ storage });

const promptPath = path.join(__dirname, "..", "prompts", "vitisense-system.txt");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/messages (texto + imagen + contexto)
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const text = req.body.text || "";
    const rawHistory = req.body.history || "[]";
    const history = JSON.parse(rawHistory);

    let imageUrl = null;

    // Obtener email desde el token
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ success: false, message: "Token no proporcionado" });

    const token = authHeader.split(" ")[1];
    let userEmail = null;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userEmail = decoded.email;
    } catch {
      return res.status(401).json({ success: false, message: "Token inválido" });
    }

    // Leer cuaderno de campo del usuario
    const cuadernoPath = path.join(__dirname, "..", "data", "cuadernos", `${userEmail}.json`);
    let contextoPersonalizado = "";
    if (fs.existsSync(cuadernoPath)) {
      const contenido = JSON.parse(fs.readFileSync(cuadernoPath, "utf-8"));
      if (Array.isArray(contenido) && contenido.length > 0) {
        contextoPersonalizado = contenido
          .map((e) => `• ${e.fecha}: ${e.entrada}`)
          .join("\n");
      }
    }

    // Construir prompt
    const systemPrompt = {
      role: "system",
      content: fs.readFileSync(promptPath, "utf-8") +
  (contextoPersonalizado
    ? `\n\n📓 A continuación se incluye el cuaderno de campo del agricultor con sus últimos tratamientos y observaciones. Debes tenerlo en cuenta para todas tus respuestas y actuar como si recordaras esa información. Si el usuario pregunta por el último tratamiento realizado, el más reciente es:\n\n${contextoPersonalizado}\n\n`
    : ""),
    };

    // Si hay imagen, subir a Cloudinary
    if (req.file) {
      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(base64Image, {
        folder: "vitisense_chat",
        use_filename: true,
        unique_filename: false,
        overwrite: true,
      });
      imageUrl = uploadResult.secure_url;
    }

    // Construir mensajes para OpenAI
    const messages = [
      systemPrompt,
      ...history.map((msg) => ({
        role: msg.sender === "user" ? "user" : "assistant",
        content: msg.text,
      })),
    ];

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