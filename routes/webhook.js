// backend/routes/webhook.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const Stripe = require("stripe");
require("dotenv").config();

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const USERS_FILE = path.join(__dirname, "../data/users.json");

// Stripe requiere el body **sin parsear** para verificar la firma
router.post(
  "/", // Montado desde /api/webhook en server.js
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

    // 🟢 Evento: pago completado
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const customerEmail = session.customer_email;
      const customerId = session.customer;

      try {
        // Leer archivo de usuarios
        const users = fs.existsSync(USERS_FILE)
          ? JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"))
          : [];

        const existingUserIndex = users.findIndex(
          (u) => u.email === customerEmail
        );

        if (existingUserIndex !== -1) {
          // 🔄 Actualizar usuario existente
          users[existingUserIndex].stripeCustomerId = customerId;
          users[existingUserIndex].subscriptionActive = true;
          users[existingUserIndex].pending = false;
          console.log(`✅ Usuario actualizado: ${customerEmail}`);
        } else {
          // 🆕 Crear usuario nuevo (solo si pago exitoso)
          users.push({
            email: customerEmail,
            password: null, // opcional, puede eliminarse
            stripeCustomerId: customerId,
            subscriptionActive: true,
            pending: false,
          });
          console.log(`✅ Usuario creado tras pago: ${customerEmail}`);
        }

        // Guardar cambios
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
      } catch (err) {
        console.error("❌ Error al guardar usuario tras pago:", err);
      }
    }

    // Stripe necesita esta respuesta para confirmar recepción
    res.json({ received: true });
  }
);

module.exports = router;