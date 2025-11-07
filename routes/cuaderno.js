const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const authMiddleware = require("../middleware/auth");

const CUADERNOS_DIR = path.join(__dirname, "../data/cuadernos");

if (!fs.existsSync(CUADERNOS_DIR)) {
  fs.mkdirSync(CUADERNOS_DIR, { recursive: true });
  console.log("📁 Carpeta de cuadernos creada:", CUADERNOS_DIR);
}

// GET - Obtener entradas del usuario
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

// POST - Añadir entrada
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

// ✅ PUT - Editar una entrada por índice
router.put("/:index", authMiddleware, (req, res) => {
  const email = req.user.email;
  const index = parseInt(req.params.index, 10);
  const { entrada } = req.body;

  if (isNaN(index) || !entrada || typeof entrada !== "string") {
    return res.status(400).json({ error: "Índice o entrada inválidos" });
  }

  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "No hay entradas para editar" });
  }

  try {
    const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(entries) || !entries[index]) {
      return res.status(404).json({ error: "Entrada no encontrada" });
    }

    entries[index].entrada = entrada.trim();
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
    return res.json(entries);
  } catch (err) {
    console.error("❌ Error al editar entrada:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

// ✅ DELETE - Eliminar una entrada por índice
router.delete("/:index", authMiddleware, (req, res) => {
  const email = req.user.email;
  const index = parseInt(req.params.index, 10);

  if (isNaN(index)) {
    return res.status(400).json({ error: "Índice inválido" });
  }

  const filePath = path.join(CUADERNOS_DIR, `${email}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "No hay entradas para eliminar" });
  }

  try {
    const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(entries) || !entries[index]) {
      return res.status(404).json({ error: "Entrada no encontrada" });
    }

    entries.splice(index, 1);
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
    return res.json(entries);
  } catch (err) {
    console.error("❌ Error al eliminar entrada:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

module.exports = router;