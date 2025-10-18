// backend/routes/webhook.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const Stripe = require("stripe");
require("dotenv").config();

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const USERS_FILE = path.join(__dirname, "../users.json");

// Stripe requiere el body **sin parsear** para verificar la firma
router.post(
  "/", // ✅ AQUÍ: quitar "/webhook"
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

    // ✅ Gestionar eventos concretos
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const customerEmail = session.customer_email;
      const customerId = session.customer;

      try {
        const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
        const userIndex = users.findIndex((u) => u.email === customerEmail);

        if (userIndex !== -1) {
          users[userIndex].stripeCustomerId = customerId;

          fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
          console.log(`✅ Usuario actualizado con stripeCustomerId: ${customerId}`);
        } else {
          console.warn(`⚠️ Usuario con email ${customerEmail} no encontrado`);
        }
      } catch (err) {
        console.error("❌ Error actualizando users.json:", err);
      }
    }

    // Responder a Stripe que todo OK
    res.json({ received: true });
  }
);

module.exports = router;