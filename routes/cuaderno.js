const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const authMiddleware = require("../middleware/auth");

const CUADERNO_PATH = path.join(__dirname, "../data/cuadernos.json");

// 🔧 Asegúrate de que el archivo cuadernos.json exista
if (!fs.existsSync(CUADERNO_PATH)) {
  fs.writeFileSync(CUADERNO_PATH, JSON.stringify({}));
}

// GET /api/cuaderno – Obtener cuaderno del usuario
router.get("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const rawData = fs.readFileSync(CUADERNO_PATH);
  const cuadernos = JSON.parse(rawData);

  const cuaderno = cuadernos[email] || [];
  res.json(cuaderno);
});

// POST /api/cuaderno – Añadir entrada al cuaderno del usuario
router.post("/", authMiddleware, (req, res) => {
  const email = req.user.email;
  const { entrada } = req.body;

  if (!entrada || entrada.trim() === "") {
    return res.status(400).json({ error: "Entrada vacía" });
  }

  const rawData = fs.readFileSync(CUADERNO_PATH);
  const cuadernos = JSON.parse(rawData);

  const nuevaEntrada = {
    fecha: new Date().toISOString(),
    entrada: entrada.trim(),
  };

  if (!cuadernos[email]) {
    cuadernos[email] = [];
  }

  cuadernos[email].unshift(nuevaEntrada); // Añadir al principio

  fs.writeFileSync(CUADERNO_PATH, JSON.stringify(cuadernos, null, 2));
  res.json(cuadernos[email]);
});

module.exports = router;