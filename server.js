const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3010;

// ✅ Configurar carpeta persistente de conversaciones (Render vs Local)
const isProduction = process.env.NODE_ENV === 'production';
const conversationsDir = isProduction
  ? '/mnt/data/conversations'
  : path.join(__dirname, 'data', 'conversations');

if (!fs.existsSync(conversationsDir)) {
  fs.mkdirSync(conversationsDir, { recursive: true });
  console.log(`📁 Carpeta de conversaciones creada en: ${conversationsDir}`);
}

app.set('conversationsDir', conversationsDir);

// ✅ CORS para desarrollo y producción
const allowedOrigins = [
  'http://localhost:5173',
  'https://www.vitisense.es',
  'https://vitisense-frontend.vercel.app',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
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
app.use('/api/stripe/webhook', webhookRoutes);

// ✅ body-parser JSON (después del webhook de Stripe)
app.use(bodyParser.json());

// ✅ body-parser URL-encoded para Twilio WhatsApp
app.use(bodyParser.urlencoded({ extended: false }));

// ✅ Rutas importadas
const authRoutes = require('./routes/auth');
const conversationsRoutes = require('./routes/conversations');
const stripeRoutes = require('./routes/stripe');
const messagesRoutes = require('./routes/message');
const cuadernoRoutes = require('./routes/cuaderno');

// ✅ Montar rutas
app.use('/api/messages', messagesRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/cuaderno', cuadernoRoutes);

// ✅ Cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Cargar prompt desde archivo — única fuente de verdad
const promptBase = fs.readFileSync(
  path.join(__dirname, 'prompts', 'vitisense-system.txt'),
  'utf-8'
);

// Prompt para la app web — usa el archivo tal cual
const systemPrompt = {
  role: 'system',
  content: promptBase,
};

// Prompt para WhatsApp — mismo prompt base + instrucciones de formato
const systemPromptWhatsApp = {
  role: 'system',
  content: `${promptBase}

---
INSTRUCCIONES ADICIONALES PARA WHATSAPP:
Estás respondiendo por WhatsApp. El canal no soporta markdown.
NUNCA uses asteriscos (*), guiones de lista, numeración forzada ni etiquetas como "Decisión clara:", "Recomendación técnica:" o "Frase final:".
Escribe en texto plano, como un mensaje de móvil entre profesionales.
Separa las ideas con saltos de línea simples. Nada más.
El contenido y criterio técnico deben ser exactamente los mismos que en cualquier otro canal. Solo cambia el formato.`,
};

// ✅ Ruta IA (GPT-4o) — para la app web
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

// ✅ ─────────────────────────────────────────────
//    WEBHOOK WHATSAPP (Twilio)
// ─────────────────────────────────────────────

// Memoria temporal de conversaciones por número de WhatsApp
const whatsappSessions = {};

app.post('/webhook/whatsapp', async (req, res) => {
  const mensajeEntrada = req.body.Body?.trim();
  const numeroUsuario = req.body.From; // formato: whatsapp:+34XXXXXXXXX

  if (!mensajeEntrada || !numeroUsuario) {
    return res.sendStatus(400);
  }

  console.log(`📱 WhatsApp [${numeroUsuario}]: ${mensajeEntrada}`);

  // Inicializar historial si es la primera vez que escribe
  if (!whatsappSessions[numeroUsuario]) {
    whatsappSessions[numeroUsuario] = [];
  }

  // Añadir el mensaje del usuario al historial
  whatsappSessions[numeroUsuario].push({
    role: 'user',
    content: mensajeEntrada,
  });

  // Limitar historial a los últimos 10 mensajes para no disparar tokens
  const historialReciente = whatsappSessions[numeroUsuario].slice(-10);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [systemPromptWhatsApp, ...historialReciente],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const respuesta = completion.choices[0].message.content;

    // Guardar respuesta en el historial
    whatsappSessions[numeroUsuario].push({
      role: 'assistant',
      content: respuesta,
    });

    // Enviar respuesta por WhatsApp via Twilio
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await twilioClient.messages.create({
      from: 'whatsapp:+14155238886', // Número sandbox de Twilio
      to: numeroUsuario,
      body: respuesta,
    });

    // ✅ Respuesta TwiML vacía — elimina el "OK" automático de Twilio
    const twiml = new twilio.twiml.MessagingResponse();
    res.type('text/xml');
    res.send(twiml.toString());

  } catch (err) {
    console.error('❌ Error en webhook WhatsApp:', err);
    res.sendStatus(500);
  }
});

// ✅ Ruta 404 si no existe ninguna otra
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ✅ Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor VITISENSE escuchando en http://localhost:${PORT}`);
  console.log(`📱 Webhook WhatsApp disponible en /webhook/whatsapp`);
});