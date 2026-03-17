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

// Prompt para la app web
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

// ✅ ─────────────────────────────────────────────
//    HELPERS — usuarios y límites WhatsApp
// ─────────────────────────────────────────────

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const LIMITE_CONSULTAS = 5;
const AVISO_EN_CONSULTA = 3;

function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Comprueba si el número de WhatsApp tiene suscripción activa
function isSuscrito(numeroWhatsApp) {
  const users = loadUsers();
  // El número llega como "whatsapp:+34XXXXXXXXX", normalizamos
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  return users.some(
    (u) => u.whatsapp === numeroLimpio && u.subscriptionActive === true
  );
}

// Devuelve las consultas usadas por un número (persiste en users.json)
function getConsultasUsadas(numeroWhatsApp) {
  const users = loadUsers();
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  const entry = users.find((u) => u.whatsapp === numeroLimpio);
  return entry ? (entry.whatsappConsultas || 0) : 0;
}

// Incrementa el contador de consultas de un número
function incrementarConsultas(numeroWhatsApp) {
  const users = loadUsers();
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  const entry = users.find((u) => u.whatsapp === numeroLimpio);

  if (entry) {
    entry.whatsappConsultas = (entry.whatsappConsultas || 0) + 1;
  } else {
    // Usuario nuevo — lo registramos solo con el número
    users.push({
      whatsapp: numeroLimpio,
      whatsappConsultas: 1,
      subscriptionActive: false,
    });
  }
  saveUsers(users);
}

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

const whatsappSessions = {};

app.post('/webhook/whatsapp', async (req, res) => {
  const mensajeEntrada = req.body.Body?.trim();
  const numeroUsuario = req.body.From; // formato: whatsapp:+34XXXXXXXXX

  if (!mensajeEntrada || !numeroUsuario) {
    return res.sendStatus(400);
  }

  console.log(`📱 WhatsApp [${numeroUsuario}]: ${mensajeEntrada}`);

  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const enviarMensaje = async (texto) => {
    await twilioClient.messages.create({
      from: 'whatsapp:+14155238886',
      to: numeroUsuario,
      body: texto,
    });
  };

  // ✅ Comprobar si está suscrito — si sí, acceso ilimitado
  const suscrito = isSuscrito(numeroUsuario);

  if (!suscrito) {
    const consultasUsadas = getConsultasUsadas(numeroUsuario);

    // Límite alcanzado — no responde y manda mensaje de conversión
    if (consultasUsadas >= LIMITE_CONSULTAS) {
      await enviarMensaje(
        `Has usado tus 5 consultas gratuitas de VITISENSE.\n\nPara seguir teniendo a tu agrónomo disponible sin límites, suscríbete en:\nhttps://www.vitisense.es\n\n7 días gratis, sin permanencia.`
      );
      const twiml = new twilio.twiml.MessagingResponse();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Incrementar contador antes de responder
    incrementarConsultas(numeroUsuario);
    const consultaActual = consultasUsadas + 1;

    // Inicializar historial si es la primera vez
    if (!whatsappSessions[numeroUsuario]) {
      whatsappSessions[numeroUsuario] = [];
    }

    whatsappSessions[numeroUsuario].push({ role: 'user', content: mensajeEntrada });
    const historialReciente = whatsappSessions[numeroUsuario].slice(-10);

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [systemPromptWhatsApp, ...historialReciente],
        temperature: 0.7,
        max_tokens: 1000,
      });

      let respuesta = completion.choices[0].message.content;

      whatsappSessions[numeroUsuario].push({ role: 'assistant', content: respuesta });

      // Aviso en consulta 3 — añadido al final de la respuesta
      if (consultaActual === AVISO_EN_CONSULTA) {
        respuesta += `\n\n---\nLlevas ${consultaActual} de 5 consultas gratuitas. Si quieres acceso ilimitado, entra en vitisense.es — 7 días gratis.`;
      }

      await enviarMensaje(respuesta);

    } catch (err) {
      console.error('❌ Error en webhook WhatsApp:', err);
      res.sendStatus(500);
      return;
    }

  } else {
    // ✅ Usuario suscrito — acceso ilimitado sin avisos
    if (!whatsappSessions[numeroUsuario]) {
      whatsappSessions[numeroUsuario] = [];
    }

    whatsappSessions[numeroUsuario].push({ role: 'user', content: mensajeEntrada });
    const historialReciente = whatsappSessions[numeroUsuario].slice(-10);

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [systemPromptWhatsApp, ...historialReciente],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const respuesta = completion.choices[0].message.content;
      whatsappSessions[numeroUsuario].push({ role: 'assistant', content: respuesta });
      await enviarMensaje(respuesta);

    } catch (err) {
      console.error('❌ Error en webhook WhatsApp (suscrito):', err);
      res.sendStatus(500);
      return;
    }
  }

  // ✅ Respuesta TwiML vacía — elimina el "OK" automático de Twilio
  const twiml = new twilio.twiml.MessagingResponse();
  res.type('text/xml');
  res.send(twiml.toString());
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