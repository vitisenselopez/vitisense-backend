const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3010;

// ✅ CORS para desarrollo y producción
const allowedOrigins = [
  'http://localhost:5173',
  'https://www.vitisense.es',
  'https://vitisense-frontend.vercel.app',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Permite curl/Postman
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
}));

// ✅ Ruta Webhook Stripe (debe ir ANTES de bodyParser)
const webhookRoutes = require('./routes/webhook');
app.use('/api/stripe/webhook', webhookRoutes); // ⚠️ ESTA es la ruta real que usa Stripe

// ✅ body-parser (después del webhook)
app.use(bodyParser.json());

// ✅ Otras rutas
const authRoutes = require('./routes/auth');
const conversationsRoutes = require('./routes/conversations');
const stripeRoutes = require('./routes/stripe');
const messagesRoutes = require('./routes/message');
app.use('/api/messages', messagesRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/stripe', stripeRoutes);

// ✅ Ruta IA (GPT-4o)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const systemPrompt = {
  role: "system",
  content:
    "Eres VITISENSE, asesor técnico experto en viticultura. Debes responder como si fueras un ingeniero agrónomo experimentado, dando soluciones claras, firmes y aplicables, como en una consulta real de campo. Si el usuario describe un problema, da la mejor recomendación concreta y justificada, sin rodeos ni largas explicaciones, priorizando fitosanitarios con principio activo, dosis y modo de uso habituales según la práctica agronómica, adaptando según la variedad, fase fenológica, clima y tratamientos previos si se indican. Si el usuario solo pide información, responde con explicaciones breves, claras y prácticas, sin extenderte ni escribir como una enciclopedia. Sé siempre directo y natural, como un asesor real que guía con criterio técnico, sin rodeos. Tu función es resolver y guiar, no dar clases teóricas. Si falta información, pregunta con precisión, sin divagar. Responde como si hablaras cara a cara con el agricultor en la cooperativa.",
};

app.post('/api/ask', async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'No se ha recibido un historial de mensajes válido.' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [systemPrompt, ...messages],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const answer = completion.choices[0].message.content;
    res.json({ response: answer });
  } catch (err) {
    console.error('Error al generar la respuesta:', err);
    res.status(500).json({ error: 'Error al generar la respuesta con GPT-4o' });
  }
});

// ✅ Ruta 404 si no existe ninguna otra
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ✅ Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en http://localhost:${PORT}`);
});