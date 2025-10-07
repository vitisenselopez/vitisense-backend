const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const USERS_FILE = path.join(__dirname, "../data/users.json");

// Función para cargar usuarios
function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Función para guardar usuario tras pago
function saveUser(email) {
  const users = loadUsers();
  if (users.find((u) => u.email === email)) {
    console.log(`ℹ️ Usuario ${email} ya existe, no se duplica.`);
    return;
  }

  users.push({ email, password: null, isActive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  console.log(`✅ Usuario creado tras pago exitoso: ${email}`);
}

// Ruta del webhook
router.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Error verificando firma del webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Procesar el evento de pago completado
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email = session.customer_email || session.client_reference_id;

    if (email) {
      saveUser(email);
    } else {
      console.warn("⚠️ No se pudo guardar usuario: email no encontrado en la sesión.");
    }
  }

  res.status(200).send("Webhook recibido");
});

module.exports = router;