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
  } catch (error) {
    console.error("❌ Error leyendo users.json:", error.message);
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
  } catch (error) {
    console.error("❌ Error guardando users.json:", error.message);
  }
}

// 🟢 REGISTRO
router.post("/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Faltan campos" });

  const users = loadUsers();
  const userExists = users.find((u) => u.email === email);
  if (userExists) return res.status(409).json({ error: "El usuario ya existe" });

  const newUser = {
    email,
    password,
    stripeCustomerId: null,
    subscriptionActive: false,
    pending: true, // ✅ Solo se activa si completa pago en Stripe
  };

  users.push(newUser);
  saveUsers(users);

  const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "1d" });
  res.json({ token });
});

// 🟢 LOGIN
router.post("/login", (req, res) => {
  const { email, password } = req.body;
  const users = loadUsers();

  if (!Array.isArray(users)) return res.status(500).json({ error: "Formato de usuarios inválido" });

  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  if (user.pending) {
    return res.status(403).json({ error: "Debes completar el pago para acceder." }); // ✅ Bloqueo
  }

  const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  res.json({ token });
});

// 🟢 AUTENTICACIÓN
router.get("/me", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Token no proporcionado" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ email: decoded.email });
  } catch (err) {
    res.status(401).json({ error: "Token inválido" });
  }
});

module.exports = router;