const express = require('express');
const Stripe = require('stripe');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const USERS_FILE = path.join(__dirname, '../users.json');
const CANCEL_FILE = path.join(__dirname, '../cancel_requests.json');
const JWT_SECRET = process.env.JWT_SECRET || 'clave_por_defecto';

// ✅ Crear sesión de pago con plan dinámico
router.post('/create-checkout-session', async (req, res) => {
  const { email, plan } = req.body;

  const priceId = plan === 'coop'
    ? process.env.STRIPE_PRICE_ID_COOP
    : process.env.STRIPE_PRICE_ID_PRO;

  if (!priceId) {
    return res.status(400).json({ error: 'Plan seleccionado no válido' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
      },
      success_url: 'http://localhost:5173/',
      cancel_url: 'http://localhost:5173/',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('❌ Error al crear la sesión de Stripe:', error);
    res.status(500).json({ error: 'Error al crear la sesión de Stripe' });
  }
});

// ✅ Portal de cliente (requiere customerId válido)
router.post('/customer-portal', async (req, res) => {
  const { customerId } = req.body;

  if (!customerId) {
    return res.status(400).json({ error: 'Falta customerId' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'http://localhost:5173/profile',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('❌ Error al crear el portal de cliente:', error);
    res.status(500).json({ error: 'Error al abrir el portal de Stripe' });
  }
});

// ✅ Obtener stripeCustomerId desde JWT
router.get('/get-customer-id', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    const user = users.find((u) => u.email === decoded.email);

    if (!user || !user.stripeCustomerId) {
      return res.json({ customerId: null });
    }

    return res.json({ customerId: user.stripeCustomerId });
  } catch (err) {
    console.error('❌ Error leyendo usuario:', err);
    return res.status(500).json({ error: 'Error interno al obtener customerId' });
  }
});

// ✅ Recibir solicitud de cancelación desde el frontend
router.post('/request-cancel-subscription', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { message } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Mensaje de cancelación vacío' });
    }

    const cancelData = {
      email: decoded.email,
      date: new Date().toISOString(),
      message: message.trim(),
    };

    const existing = fs.existsSync(CANCEL_FILE)
      ? JSON.parse(fs.readFileSync(CANCEL_FILE, 'utf-8'))
      : [];

    existing.push(cancelData);

    fs.writeFileSync(CANCEL_FILE, JSON.stringify(existing, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al procesar solicitud de cancelación:", err);
    res.status(500).json({ error: 'Error interno al guardar la solicitud' });
  }
});

module.exports = router;