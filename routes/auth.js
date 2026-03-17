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

// ✅ Helper para obtener el email del token
function getEmailFromToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.email;
  } catch {
    return null;
  }
}

// 🟢 REGISTRO
router.post("/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Faltan campos obligatorios." });

  const users = loadUsers();

  const alreadyPaid = users.find(
    (u) => u.email === email && u.subscriptionActive === true
  );
  if (alreadyPaid)
    return res.status(409).json({ error: "El usuario ya existe y está activo." });

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
    return res.status(401).json({ error: "Credenciales inválidas o usuario no registrado." });

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

// ✅ OBTENER PERFIL — devuelve email y whatsapp del usuario
router.get("/perfil", (req, res) => {
  const email = getEmailFromToken(req);
  if (!email) return res.status(401).json({ error: "Token inválido." });

  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });

  return res.json({
    email: user.email,
    whatsapp: user.whatsapp || null,
    subscriptionActive: user.subscriptionActive || false,
  });
});

// ✅ VINCULAR NÚMERO DE WHATSAPP
router.post("/whatsapp", (req, res) => {
  const email = getEmailFromToken(req);
  if (!email) return res.status(401).json({ error: "Token inválido." });

  const { whatsapp } = req.body;
  if (!whatsapp) return res.status(400).json({ error: "Número no proporcionado." });

  const numeroLimpio = whatsapp.trim().replace(/\s/g, "");
  if (!numeroLimpio.startsWith("+"))
    return res.status(400).json({ error: "El número debe incluir prefijo internacional. Ej: +34612345678" });

  const users = loadUsers();

  // Comprobar que el número no esté ya vinculado a otra cuenta
  const duplicado = users.find(
    (u) => u.whatsapp === numeroLimpio && u.email !== email
  );
  if (duplicado)
    return res.status(409).json({ error: "Este número ya está vinculado a otra cuenta." });

  const user = users.find((u) => u.email === email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });

  user.whatsapp = numeroLimpio;
  saveUsers(users);

  console.log(`📱 WhatsApp vinculado: ${email} → ${numeroLimpio}`);
  return res.json({ message: "Número vinculado correctamente.", whatsapp: numeroLimpio });
});

module.exports = router;