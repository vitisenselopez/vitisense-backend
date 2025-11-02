const express = require("express");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const path = require("path");

const router = express.Router();
const USERS_FILE = path.join(__dirname, "../data/users.json");

function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// 🟢 REGISTRO — Guarda usuario provisional con contraseña
router.post("/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Faltan campos obligatorios." });

  const users = loadUsers();

  // Verificamos si ya está registrado y activo
  const alreadyPaid = users.find(
    (u) => u.email === email && u.subscriptionActive === true
  );

  if (alreadyPaid)
    return res.status(409).json({ error: "El usuario ya existe y está activo." });

  // Si el usuario no está registrado, lo guardamos provisionalmente
  const existing = users.find((u) => u.email === email);
  if (!existing) {
    users.push({
      email,
      password,
      subscriptionActive: false,
      pending: true,
    });
    saveUsers(users);
    console.log(`🟡 Usuario provisional guardado: ${email}`);
  }

  // Generamos token provisional
  const token = jwt.sign({ email, password }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  return res.json({
    message: "Usuario provisional creado. Completa el pago para activar tu cuenta.",
    token,
  });
});

// 🟢 LOGIN
router.post("/login", (req, res) => {
  const { email, password } = req.body;
  const users = loadUsers();

  if (!Array.isArray(users))
    return res.status(500).json({ error: "Error leyendo usuarios." });

  const user = users.find((u) => u.email === email && u.password === password);
  if (!user)
    return res
      .status(401)
      .json({ error: "Credenciales inválidas o usuario no registrado." });

  if (user.pending)
    return res.status(403).json({ error: "Debes completar el pago para acceder." });

  const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

  return res.json({ token });
});

// 🟢 AUTENTICACIÓN
router.get("/me", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res.status(401).json({ error: "Token no proporcionado." });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ email: decoded.email });
  } catch {
    res.status(401).json({ error: "Token inválido." });
  }
});

module.exports = router;