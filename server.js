const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const axios = require('axios');
const FormData = require('form-data');
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

const systemPrompt = {
  role: 'system',
  content: promptBase,
};

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

function isSuscrito(numeroWhatsApp) {
  const users = loadUsers();
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  return users.some(
    (u) => u.whatsapp === numeroLimpio && u.subscriptionActive === true
  );
}

function getConsultasUsadas(numeroWhatsApp) {
  const users = loadUsers();
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  const entry = users.find((u) => u.whatsapp === numeroLimpio);
  return entry ? (entry.whatsappConsultas || 0) : 0;
}

function incrementarConsultas(numeroWhatsApp) {
  const users = loadUsers();
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  const entry = users.find((u) => u.whatsapp === numeroLimpio);

  if (entry) {
    entry.whatsappConsultas = (entry.whatsappConsultas || 0) + 1;
  } else {
    users.push({
      whatsapp: numeroLimpio,
      whatsappConsultas: 1,
      subscriptionActive: false,
    });
  }
  saveUsers(users);
}

// ✅ ─────────────────────────────────────────────
//    WHISPER — transcribir audio de WhatsApp
// ─────────────────────────────────────────────

async function transcribirAudio(mediaUrl) {
  const audioResponse = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
  });

  const tmpPath = path.join('/tmp', `audio_${Date.now()}.ogg`);
  fs.writeFileSync(tmpPath, audioResponse.data);

  const formData = new FormData();
  formData.append('file', fs.createReadStream(tmpPath), {
    filename: 'audio.ogg',
    contentType: 'audio/ogg',
  });
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');

  const whisperRes = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }
  );

  fs.unlinkSync(tmpPath);
  return whisperRes.data.text;
}

// ✅ ─────────────────────────────────────────────
//    GPT-4o VISION — analizar imagen de WhatsApp
// ─────────────────────────────────────────────

async function analizarImagen(mediaUrl, textoAdicional) {
  // Descargar imagen desde Twilio con autenticación
  const imgResponse = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
  });

  // Convertir a base64
  const base64 = Buffer.from(imgResponse.data).toString('base64');
  const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';

  const mensajeUsuario = {
    role: 'user',
    content: [
      {
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`,
        },
      },
      {
        type: 'text',
        text: textoAdicional || 'Analiza esta imagen y dame tu diagnóstico y recomendación técnica.',
      },
    ],
  };

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [systemPromptWhatsApp, mensajeUsuario],
    temperature: 0.7,
    max_tokens: 1000,
  });

  return completion.choices[0].message.content;
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
  const numeroUsuario = req.body.From;
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0;
  let mensajeEntrada = req.body.Body?.trim();

  if (!numeroUsuario) return res.sendStatus(400);

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

  const twimlVacio = () => {
    const twiml = new twilio.twiml.MessagingResponse();
    res.type('text/xml');
    res.send(twiml.toString());
  };

  // ✅ Si hay AUDIO — transcribir con Whisper
  if (mediaUrl && mediaType && mediaType.startsWith('audio')) {
    try {
      console.log(`🎤 Audio recibido de ${numeroUsuario}, transcribiendo...`);
      mensajeEntrada = await transcribirAudio(mediaUrl);
      console.log(`📝 Transcripción: ${mensajeEntrada}`);
    } catch (err) {
      console.error('❌ Error transcribiendo audio:', err);
      await enviarMensaje('No he podido escuchar el audio. ¿Puedes escribirme la consulta?');
      return twimlVacio();
    }
  }

  // ✅ Si hay IMAGEN — analizar con GPT-4o Vision
  if (mediaUrl && mediaType && mediaType.startsWith('image')) {
    console.log(`🖼️ Imagen recibida de ${numeroUsuario}, analizando...`);

    const suscrito = isSuscrito(numeroUsuario);

    if (!suscrito) {
      const consultasUsadas = getConsultasUsadas(numeroUsuario);

      if (consultasUsadas >= LIMITE_CONSULTAS) {
        await enviarMensaje(
          `Has usado tus 5 consultas gratuitas de VITISENSE.\n\nPara seguir teniendo a tu agrónomo disponible sin límites, suscríbete en:\nhttps://www.vitisense.es\n\n7 días gratis, sin permanencia.`
        );
        return twimlVacio();
      }

      incrementarConsultas(numeroUsuario);
      const consultaActual = consultasUsadas + 1;

      try {
        let respuesta = await analizarImagen(mediaUrl, mensajeEntrada);

        if (consultaActual === AVISO_EN_CONSULTA) {
          respuesta += `\n\n---\nLlevas ${consultaActual} de 5 consultas gratuitas. Si quieres acceso ilimitado, entra en vitisense.es — 7 días gratis.`;
        }

        await enviarMensaje(respuesta);
      } catch (err) {
        console.error('❌ Error analizando imagen:', err);
        await enviarMensaje('No he podido analizar la imagen. ¿Puedes describirme qué ves en la planta?');
      }

    } else {
      try {
        const respuesta = await analizarImagen(mediaUrl, mensajeEntrada);
        await enviarMensaje(respuesta);
      } catch (err) {
        console.error('❌ Error analizando imagen (suscrito):', err);
        await enviarMensaje('No he podido analizar la imagen. ¿Puedes describirme qué ves en la planta?');
      }
    }

    return twimlVacio();
  }

  // ✅ Mensaje de texto normal
  if (!mensajeEntrada) {
    await enviarMensaje('No he recibido ningún mensaje. ¿Puedes escribirme o enviarme un audio?');
    return twimlVacio();
  }

  console.log(`📱 WhatsApp [${numeroUsuario}]: ${mensajeEntrada}`);

  const suscrito = isSuscrito(numeroUsuario);

  if (!suscrito) {
    const consultasUsadas = getConsultasUsadas(numeroUsuario);

    if (consultasUsadas >= LIMITE_CONSULTAS) {
      await enviarMensaje(
        `Has usado tus 5 consultas gratuitas de VITISENSE.\n\nPara seguir teniendo a tu agrónomo disponible sin límites, suscríbete en:\nhttps://www.vitisense.es\n\n7 días gratis, sin permanencia.`
      );
      return twimlVacio();
    }

    incrementarConsultas(numeroUsuario);
    const consultaActual = consultasUsadas + 1;

    if (!whatsappSessions[numeroUsuario]) whatsappSessions[numeroUsuario] = [];
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
    if (!whatsappSessions[numeroUsuario]) whatsappSessions[numeroUsuario] = [];
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

  twimlVacio();
});

// ✅ Ruta 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ✅ Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor VITISENSE escuchando en http://localhost:${PORT}`);
  console.log(`📱 Webhook WhatsApp disponible en /webhook/whatsapp`);
  console.log(`🎤 Whisper activado para audios`);
  console.log(`🖼️ GPT-4o Vision activado para imágenes`);
});