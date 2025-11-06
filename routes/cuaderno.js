const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const authMiddleware = require("../middleware/auth");

const CUADERNOS_DIR = path.join(__dirname, "../data/cuadernos");

// Crear carpeta si no existe
if (!fs.existsSync(CUADERNOS_DIR)) {
  fs.mkdirSync(CUADERNOS_DIR, { recursive: true });
}

// GET /api/cuaderno – Obtener entradas del cuaderno del usuario
router.get("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  if (!fs.existsSync(filePath)) {
    return res.json([]); // Cuaderno vacío
  }

  const data = fs.readFileSync(filePath, "utf-8");
  try {
    const entries = JSON.parse(data);
    res.json(entries);
  } catch (err) {
    console.error("❌ Error leyendo el cuaderno:", err);
    res.status(500).json({ error: "Error al leer el cuaderno de campo" });
  }
});

// POST /api/cuaderno – Añadir una nueva entrada al cuaderno
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
  res.json(entries);
});

module.exports = router;