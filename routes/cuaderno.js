const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const authMiddleware = require("../middleware/auth");

// 🧠 Detectar entorno
const isProduction = process.env.NODE_ENV === "production";

// ✅ Usar disco persistente en Render
const CUADERNOS_DIR = isProduction
  ? "/mnt/data/conversations" // Carpeta persistente en Render
  : path.join(__dirname, "../data/cuadernos"); // Carpeta local

// Crear carpeta solo en entorno local
if (!isProduction && !fs.existsSync(CUADERNOS_DIR)) {
  fs.mkdirSync(CUADERNOS_DIR, { recursive: true });
  console.log(`📁 Carpeta de cuadernos creada en: ${CUADERNOS_DIR}`);
}

// GET /api/cuaderno – Obtener entradas del cuaderno del usuario
router.get("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  if (!fs.existsSync(filePath)) {
    return res.json([]); // No hay cuaderno aún
  }

  try {
    const data = fs.readFileSync(filePath, "utf-8");
    const entries = JSON.parse(data);
    return res.json(entries);
  } catch (err) {
    console.error("❌ Error leyendo el cuaderno:", err);
    return res.status(500).json({ error: "Error al leer el cuaderno" });
  }
});

// POST /api/cuaderno – Añadir una nueva entrada
router.post("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const { entrada } = req.body;

  if (!entrada || typeof entrada !== "string" || entrada.trim() === "") {
    return res.status(400).json({ error: "Entrada vacía o inválida" });
  }

  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  let entries = [];
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      entries = JSON.parse(raw);
    } catch (err) {
      console.warn("⚠️ Archivo de cuaderno dañado o vacío, se reinicia.");
      entries = [];
    }
  }

  const nuevaEntrada = {
    fecha: new Date().toISOString(),
    entrada: entrada.trim(),
  };

  entries.unshift(nuevaEntrada);

  try {
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
    return res.json(entries);
  } catch (err) {
    console.error("❌ Error escribiendo cuaderno:", err);
    return res.status(500).json({ error: "No se pudo guardar la entrada" });
  }
});

module.exports = router;