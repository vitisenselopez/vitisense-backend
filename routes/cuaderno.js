const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const authMiddleware = require("../middleware/auth");

// 📌 Detectar entorno
const isProduction = process.env.NODE_ENV === "production";

// 📁 Ruta persistente
const CUADERNOS_DIR = isProduction
  ? "/mnt/data" // ⛔️ No crear subcarpetas aquí
  : path.join(__dirname, "../data/cuadernos");

// Crear carpeta si no existe
if (!fs.existsSync(CUADERNOS_DIR)) {
  fs.mkdirSync(CUADERNOS_DIR, { recursive: true });
  console.log(`📁 Carpeta de cuadernos creada en: ${CUADERNOS_DIR}`);
}

// GET /api/cuaderno – Obtener entradas del cuaderno del usuario
router.get("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  if (!fs.existsSync(filePath)) {
    return res.json([]); // No tiene entradas aún
  }

  try {
    const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return res.json(entries);
  } catch (err) {
    console.error("❌ Error leyendo cuaderno:", err);
    return res.status(500).json({ error: "Error al leer cuaderno" });
  }
});

// POST /api/cuaderno – Añadir entrada
router.post("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const { entrada } = req.body;

  if (!entrada || entrada.trim() === "") {
    return res.status(400).json({ error: "Entrada vacía" });
  }

  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  let entries = [];
  if (fs.existsSync(filePath)) {
    try {
      entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      entries = [];
    }
  }

  const nuevaEntrada = {
    fecha: new Date().toISOString(),
    entrada: entrada.trim(),
  };

  entries.unshift(nuevaEntrada);

  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
  return res.json(entries);
});

module.exports = router;