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

// 🟢 REGISTRO — NO guarda usuario todavía
router.post("/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Faltan campos obligatorios." });

  // Solo verificamos si el email ya fue activado tras pago
  const users = loadUsers();
  const alreadyPaid = users.find(
    (u) => u.email === email && u.subscriptionActive === true
  );

  if (alreadyPaid)
    return res.status(409).json({ error: "El usuario ya existe y está activo." });

  // ✅ NO guardamos nada todavía
  // Stripe se encargará de crear al usuario en el webhook cuando pague
  const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "1h" });
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

const CANCEL_FILE = path.join(__dirname, "../data/cancel_requests.json");

router.post("/user", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res.status(401).json({ error: "Token no proporcionado." });

  const token = authHeader.split(" ")[1];
  let email;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    email = decoded.email;
  } catch {
    return res.status(401).json({ error: "Token inválido." });
  }

  const { message } = req.body;
  if (!message)
    return res.status(400).json({ error: "Falta el mensaje de cancelación." });

  const cancelRequest = {
    email,
    message,
    date: new Date().toISOString(),
  };

  try {
    const existing = fs.existsSync(CANCEL_FILE)
      ? JSON.parse(fs.readFileSync(CANCEL_FILE, "utf8"))
      : [];

    existing.push(cancelRequest);

    fs.writeFileSync(CANCEL_FILE, JSON.stringify(existing, null, 2), "utf8");

    return res.status(200).json({ message: "Solicitud de cancelación guardada." });
  } catch (err) {
    console.error("❌ Error guardando cancelación:", err);
    return res.status(500).json({ error: "Error al guardar la solicitud." });
  }

  // 🟠 CANCELACIÓN DE SUSCRIPCIÓN
router.post("/user", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No autorizado" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const email = decoded.email;
    const { message } = req.body;

    // Guardamos la solicitud en un archivo local
    const cancelFile = path.join(__dirname, "../data/cancel_requests.json");

    const current = fs.existsSync(cancelFile)
      ? JSON.parse(fs.readFileSync(cancelFile, "utf8"))
      : [];

    current.push({ email, message, date: new Date().toISOString() });

    fs.writeFileSync(cancelFile, JSON.stringify(current, null, 2));

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al procesar cancelación:", err);
    res.status(400).json({ error: "Token inválido o fallo interno." });
  }
});
});