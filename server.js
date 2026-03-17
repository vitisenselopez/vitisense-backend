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

// ✅ Carpeta para historiales de WhatsApp persistentes
const whatsappDir = isProduction
  ? '/mnt/data/whatsapp'
  : path.join(__dirname, 'data', 'whatsapp');

if (!fs.existsSync(whatsappDir)) {
  fs.mkdirSync(whatsappDir, { recursive: true });
  console.log(`📁 Carpeta de sesiones WhatsApp creada en: ${whatsappDir}`);
}

// ✅ CORS
const allowedOrigins = [
  'http://localhost:5173',
  'https://www.vitisense.es',
  'https://vitisense-frontend.vercel.app',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('No permitido por CORS'));
  },
  credentials: true,
}));

// ✅ Ruta Webhook Stripe (debe ir ANTES de bodyParser)
const webhookRoutes = require('./routes/webhook');
app.use('/api/stripe/webhook', webhookRoutes);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ✅ Rutas importadas
const authRoutes = require('./routes/auth');
const conversationsRoutes = require('./routes/conversations');
const stripeRoutes = require('./routes/stripe');
const messagesRoutes = require('./routes/message');
const cuadernoRoutes = require('./routes/cuaderno');

app.use('/api/messages', messagesRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/cuaderno', cuadernoRoutes);

// ✅ Cliente OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Cargar prompt desde archivo — única fuente de verdad
const promptBase = fs.readFileSync(
  path.join(__dirname, 'prompts', 'vitisense-system.txt'),
  'utf-8'
);

const systemPrompt = { role: 'system', content: promptBase };

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
//    HELPERS — usuarios y límites
// ─────────────────────────────────────────────

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const LIMITE_CONSULTAS = 999; // 🔧 MODO PRUEBAS — cambiar a 5 en producción
const AVISO_EN_CONSULTA = 3;

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function isSuscrito(numeroWhatsApp) {
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  return loadUsers().some(u => u.whatsapp === numeroLimpio && u.subscriptionActive === true);
}

function getConsultasUsadas(numeroWhatsApp) {
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  const entry = loadUsers().find(u => u.whatsapp === numeroLimpio);
  return entry ? (entry.whatsappConsultas || 0) : 0;
}

function incrementarConsultas(numeroWhatsApp) {
  const users = loadUsers();
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '');
  const entry = users.find(u => u.whatsapp === numeroLimpio);
  if (entry) {
    entry.whatsappConsultas = (entry.whatsappConsultas || 0) + 1;
  } else {
    users.push({ whatsapp: numeroLimpio, whatsappConsultas: 1, subscriptionActive: false });
  }
  saveUsers(users);
}

// ✅ ─────────────────────────────────────────────
//    HISTORIAL PERSISTENTE POR NÚMERO
// ─────────────────────────────────────────────

function getHistorialPath(numeroWhatsApp) {
  const numeroLimpio = numeroWhatsApp.replace('whatsapp:', '').replace('+', '');
  return path.join(whatsappDir, `${numeroLimpio}.json`);
}

function loadHistorial(numeroWhatsApp) {
  try { return JSON.parse(fs.readFileSync(getHistorialPath(numeroWhatsApp), 'utf8')); }
  catch { return []; }
}

function saveHistorial(numeroWhatsApp, historial) {
  fs.writeFileSync(getHistorialPath(numeroWhatsApp), JSON.stringify(historial.slice(-20), null, 2));
}

function pushHistorial(numeroWhatsApp, role, content) {
  const historial = loadHistorial(numeroWhatsApp);
  historial.push({ role, content });
  saveHistorial(numeroWhatsApp, historial);
  return historial.slice(-10); // Devuelve los últimos 10 para GPT
}

// ✅ ─────────────────────────────────────────────
//    WHISPER — transcribir audio
// ─────────────────────────────────────────────

async function transcribirAudio(mediaUrl) {
  const audioResponse = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
  });

  const tmpPath = path.join('/tmp', `audio_${Date.now()}.ogg`);
  fs.writeFileSync(tmpPath, audioResponse.data);

  const formData = new FormData();
  formData.append('file', fs.createReadStream(tmpPath), { filename: 'audio.ogg', contentType: 'audio/ogg' });
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');

  const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
    headers: { ...formData.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });

  fs.unlinkSync(tmpPath);
  return whisperRes.data.text;
}

// ✅ ─────────────────────────────────────────────
//    GPT-4o VISION — analizar imagen
// ─────────────────────────────────────────────

async function analizarImagen(mediaUrl, textoUsuario, numeroUsuario) {
  const imgResponse = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
  });

  const base64 = Buffer.from(imgResponse.data).toString('base64');
  const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';

  // Cargar historial previo para mantener contexto de la conversación
  const historialPrevio = loadHistorial(numeroUsuario).slice(-8);

  // Si el usuario no mandó texto junto a la imagen, VITISENSE pregunta qué quiere saber
  const textoConsulta = textoUsuario ||
    '¿Qué ves en esta imagen? Descríbelo y dime qué quieres que analice.';

  const mensajeImagen = {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      { type: 'text', text: textoConsulta },
    ],
  };

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [systemPromptWhatsApp, ...historialPrevio, mensajeImagen],
    temperature: 0.7,
    max_tokens: 1000,
  });

  const respuesta = completion.choices[0].message.content;

  // Guardar en historial como texto para no romper el contexto
  pushHistorial(numeroUsuario, 'user', `[Imagen] ${textoConsulta}`);
  pushHistorial(numeroUsuario, 'assistant', respuesta);

  return respuesta;
}

// ✅ Ruta IA — app web
app.post('/api/ask', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'Historial inválido.' });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [systemPrompt, ...messages],
      temperature: 0.7,
      max_tokens: 1000,
    });
    res.json({ response: completion.choices[0].message.content });
  } catch (err) {
    console.error('Error GPT web:', err);
    res.status(500).json({ error: 'Error al generar respuesta.' });
  }
});

// ✅ ─────────────────────────────────────────────
//    WEBHOOK WHATSAPP
// ─────────────────────────────────────────────

app.post('/webhook/whatsapp', async (req, res) => {
  const numeroUsuario = req.body.From;
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0;
  let mensajeEntrada = req.body.Body?.trim();

  if (!numeroUsuario) return res.sendStatus(400);

  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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

  const suscrito = isSuscrito(numeroUsuario);
  const consultasUsadas = getConsultasUsadas(numeroUsuario);

  // Comprobar límite antes de procesar nada
  if (!suscrito && consultasUsadas >= LIMITE_CONSULTAS) {
    await enviarMensaje(
      `Has usado tus 5 consultas gratuitas de VITISENSE.\n\nPara seguir teniendo a tu agrónomo disponible sin límites, suscríbete en:\nhttps://www.vitisense.es\n\n7 días gratis, sin permanencia.`
    );
    return twimlVacio();
  }

  // ✅ AUDIO — transcribir con Whisper y tratar como texto
  if (mediaUrl && mediaType && mediaType.startsWith('audio')) {
    try {
      console.log(`🎤 Audio de ${numeroUsuario}, transcribiendo...`);
      mensajeEntrada = await transcribirAudio(mediaUrl);
      console.log(`📝 Transcripción: ${mensajeEntrada}`);
    } catch (err) {
      console.error('❌ Error transcribiendo audio:', err);
      await enviarMensaje('No he podido escuchar el audio. ¿Puedes escribirme la consulta?');
      return twimlVacio();
    }
  }

  // ✅ IMAGEN — analizar con GPT-4o Vision
  if (mediaUrl && mediaType && mediaType.startsWith('image')) {
    console.log(`🖼️ Imagen de ${numeroUsuario}, analizando...`);

    // Si no hay texto junto a la imagen, preguntar qué quiere saber
    // Solo analiza directamente si el usuario escribió algo junto a la foto
    if (!mensajeEntrada) {
      // Guardar en historial que llegó una imagen sin contexto
      pushHistorial(numeroUsuario, 'user', '[Imagen sin descripción]');

      try {
        // Analizar la imagen pero pedir contexto al usuario
        const imgResponse = await axios.get(mediaUrl, {
          responseType: 'arraybuffer',
          auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
        });
        const base64 = Buffer.from(imgResponse.data).toString('base64');
        const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';
        const historialPrevio = loadHistorial(numeroUsuario).slice(-8);

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            systemPromptWhatsApp,
            ...historialPrevio,
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                { type: 'text', text: 'El agricultor me ha enviado esta imagen sin explicación. Descríbeme brevemente en 1-2 frases qué ves, y hazle UNA pregunta concreta para entender qué problema tiene o qué quiere saber.' },
              ],
            },
          ],
          temperature: 0.7,
          max_tokens: 300,
        });

        const respuesta = completion.choices[0].message.content;
        pushHistorial(numeroUsuario, 'assistant', respuesta);

        if (!suscrito) incrementarConsultas(numeroUsuario);
        await enviarMensaje(respuesta);

      } catch (err) {
        console.error('❌ Error analizando imagen sin texto:', err);
        await enviarMensaje('Veo que me has mandado una foto. ¿Qué quieres que analice? ¿Qué está pasando en la planta?');
      }

      return twimlVacio();
    }

    // Si el usuario mandó texto + imagen, analizar con contexto completo
    try {
      const respuesta = await analizarImagen(mediaUrl, mensajeEntrada, numeroUsuario);
      if (!suscrito) {
        incrementarConsultas(numeroUsuario);
        const consultaActual = consultasUsadas + 1;
        let respuestaFinal = respuesta;
        if (consultaActual === AVISO_EN_CONSULTA) {
          respuestaFinal += `\n\n---\nLlevas ${consultaActual} de 5 consultas gratuitas. Si quieres acceso ilimitado, entra en vitisense.es — 7 días gratis.`;
        }
        await enviarMensaje(respuestaFinal);
      } else {
        await enviarMensaje(respuesta);
      }
    } catch (err) {
      console.error('❌ Error analizando imagen con texto:', err);
      await enviarMensaje('No he podido analizar la imagen. ¿Puedes describirme qué ves en la planta?');
    }

    return twimlVacio();
  }

  // ✅ TEXTO (o audio transcrito)
  if (!mensajeEntrada) {
    await enviarMensaje('No he recibido ningún mensaje. ¿Puedes escribirme o enviarme un audio?');
    return twimlVacio();
  }

  console.log(`📱 WhatsApp [${numeroUsuario}]: ${mensajeEntrada}`);

  // Añadir al historial persistente y obtener los últimos 10
  const historialReciente = pushHistorial(numeroUsuario, 'user', mensajeEntrada);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [systemPromptWhatsApp, ...historialReciente],
      temperature: 0.7,
      max_tokens: 1000,
    });

    let respuesta = completion.choices[0].message.content;

    // Guardar respuesta en historial
    pushHistorial(numeroUsuario, 'assistant', respuesta);

    if (!suscrito) {
      incrementarConsultas(numeroUsuario);
      const consultaActual = consultasUsadas + 1;
      if (consultaActual === AVISO_EN_CONSULTA) {
        respuesta += `\n\n---\nLlevas ${consultaActual} de 5 consultas gratuitas. Si quieres acceso ilimitado, entra en vitisense.es — 7 días gratis.`;
      }
    }

    await enviarMensaje(respuesta);

  } catch (err) {
    console.error('❌ Error webhook WhatsApp:', err);
    res.sendStatus(500);
    return;
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
  console.log(`📱 Webhook WhatsApp en /webhook/whatsapp`);
  console.log(`🎤 Whisper activado`);
  console.log(`🖼️ GPT-4o Vision activado`);
  console.log(`💾 Historial persistente activado`);
});