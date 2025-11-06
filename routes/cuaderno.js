const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const authMiddleware = require("../middleware/auth");

// 📁 Carpeta local para los cuadernos
const CUADERNOS_DIR = path.join(__dirname, "../data/cuadernos");

// Crear carpeta si no existe
if (!fs.existsSync(CUADERNOS_DIR)) {
  fs.mkdirSync(CUADERNOS_DIR, { recursive: true });
  console.log("📁 Carpeta de cuadernos creada:", CUADERNOS_DIR);
}

// ✅ GET /api/cuaderno – Obtener entradas del usuario
router.get("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  if (!fs.existsSync(filePath)) {
    return res.json([]);
  }

  try {
    const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(entries)) throw new Error("Formato inválido");
    return res.json(entries);
  } catch (err) {
    console.error("❌ Error al leer cuaderno:", err);
    return res.json([]);
  }
});

// ✅ POST /api/cuaderno – Añadir entrada
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
      entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
  }

  const nuevaEntrada = {
    fecha: new Date().toISOString().split("T")[0],
    entrada: entrada.trim(),
  };

  entries.unshift(nuevaEntrada);
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
  return res.json(entries);
});

module.exports = router;