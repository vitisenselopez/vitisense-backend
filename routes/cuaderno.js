const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const authMiddleware = require("../middleware/auth");

const isProduction = process.env.NODE_ENV === "production";

const CUADERNOS_DIR = isProduction
  ? "/mnt/data" // No usar subcarpetas en Render
  : path.join(__dirname, "../data/cuadernos");

// Crear carpeta solo en entorno local
if (!isProduction && !fs.existsSync(CUADERNOS_DIR)) {
  fs.mkdirSync(CUADERNOS_DIR, { recursive: true });
}

// GET /api/cuaderno – Obtener entradas
router.get("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  if (!fs.existsSync(filePath)) {
    return res.json([]); // No hay entradas aún
  }

  try {
    const data = fs.readFileSync(filePath, "utf-8");
    const entries = JSON.parse(data);
    return res.json(entries);
  } catch (err) {
    console.error("❌ Error leyendo cuaderno:", err);
    return res.status(500).json({ error: "Error al leer el cuaderno" });
  }
});

// POST /api/cuaderno – Guardar nueva entrada
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
    console.error("❌ Error guardando entrada:", err);
    return res.status(500).json({ error: "Error al guardar entrada" });
  }
});

module.exports = router;