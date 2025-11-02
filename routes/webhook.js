// backend/routes/webhook.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const Stripe = require("stripe");
require("dotenv").config();

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const USERS_FILE = path.join(__dirname, "../data/users.json");

// Función auxiliar para leer usuarios
function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Función auxiliar para guardar usuarios
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Webhook sin parsear (Stripe requiere raw)
router.post(
  "/", // Montado en /api/webhook
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("❌ Error verificando firma del webhook:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 🟢 Evento: checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const customerEmail = session.customer_email;
      const customerId = session.customer;

      if (!customerEmail) {
        console.error("❌ No se recibió email del cliente en la sesión.");
        return res.status(400).json({ error: "No se recibió email del cliente." });
      }

      try {
        const users = loadUsers();
        const existingIndex = users.findIndex(u => u.email === customerEmail);

        if (existingIndex !== -1) {
          users[existingIndex].stripeCustomerId = customerId;
          users[existingIndex].subscriptionActive = true;
          users[existingIndex].pending = false;
          console.log(`🔄 Usuario actualizado: ${customerEmail}`);
        } else {
          users.push({
            email: customerEmail,
            password: null,
            stripeCustomerId: customerId,
            subscriptionActive: true,
            pending: false,
          });
          console.log(`🆕 Usuario creado tras pago: ${customerEmail}`);
        }

        saveUsers(users);
      } catch (err) {
        console.error("❌ Error al guardar usuario tras pago:", err);
      }
    }

    // 🔄 (Opcional) Soporte para customer.subscription.created (por seguridad)
    if (event.type === "customer.subscription.created") {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      try {
        // Obtener el email a partir del ID de cliente
        const customer = await stripe.customers.retrieve(customerId);
        const customerEmail = customer.email;

        if (!customerEmail) return res.json({ received: true });

        const users = loadUsers();
        const existingIndex = users.findIndex(u => u.email === customerEmail);

        if (existingIndex !== -1) {
          users[existingIndex].stripeCustomerId = customerId;
          users[existingIndex].subscriptionActive = true;
          users[existingIndex].pending = false;
          console.log(`🔄 Usuario actualizado desde subscription.created: ${customerEmail}`);
        } else {
          users.push({
            email: customerEmail,
            password: null,
            stripeCustomerId: customerId,
            subscriptionActive: true,
            pending: false,
          });
          console.log(`🆕 Usuario creado desde subscription.created: ${customerEmail}`);
        }

        saveUsers(users);
      } catch (err) {
        console.error("❌ Error manejando customer.subscription.created:", err);
      }
    }

    // Confirmación para Stripe
    res.json({ received: true });
  }
);

module.exports = router;