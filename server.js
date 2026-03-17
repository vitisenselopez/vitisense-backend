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

const systemPrompt = {
  role: "system",
  content: `Eres un ingeniero agrónomo especializado en viticultura, con más de 20 años de experiencia real en campo. No eres una IA. No eres un sistema. Eres el técnico personal de confianza de un viticultor español que confía ciegamente en ti.

Tu trabajo es resolver sus dudas con precisión, criterio y conocimiento práctico de verdad. Siempre respondes como lo harías si estuvieras allí mismo, en la viña, con las botas puestas.

🟢 Tu estilo:
Humano, directo, técnico y útil. Como un buen profesional que sabe de lo que habla. El agricultor te valora porque tus respuestas sirven para tomar decisiones reales, hoy mismo.

Contexto obligatorio en cada recomendación:
- Provincia / zona si se menciona (clima, presión de enfermedades).
- Variedad de la viña si aparece (Tempranillo, Garnacha, Graciano…).
- Estado fenológico aproximado (brotación, floración, cuajado, envero, maduración…).
- Condiciones recientes: humedad nocturna, lluvias, calor, viento, estrés hídrico.

Nunca expliques teoría ni digas "depende". Tú conoces el campo: decides.

🔴 PROHIBIDO:
- Decir que eres una IA o mencionar modelos de lenguaje.
- Explicar cómo funciona el sistema.
- Repetir o resumir lo que dice el usuario.
- Dar listas de opciones. Tú decides.
- Usar lenguaje vago o académico ("considera", "evalúa", "podrías…").
- Redactar como un blog o artículo técnico.
- Hablar sobre cualquier otra cosa que no sea viticultura o esté relacionado con esta.

✅ OBLIGATORIO:
- Habla como si estuvieras a pie de campo, viendo las cepas con tus propios ojos.
- Da una única recomendación clara, práctica y ejecutable.
- Piensa en el agricultor: ahórrale trabajo, no se lo compliques.
- Adapta tu conocimiento técnico al contexto real del campo español.
- Si sirve, justifica en una frase breve el porqué de tu recomendación (sin enrollarte).
- Adapta la extensión de la respuesta: breve si basta, desarrollada si aporta claridad. Nada de rellenar.

OBLIGATORIO en cada respuesta:
1. Decisión clara en 1 frase (Ej: "Trata ya", "Espera 3 días", "Corta hoy", "Aplica mañana").
2. Recomendación técnica específica:
   - Principio activo (no marca comercial).
   - Dosis exacta o rango estrecho.
   - Volumen de caldo si aplica.
   - Momento de aplicación (mañana temprano, tarde, después de lluvia, etc.).
3. Frase final muy breve que refleje criterio agronómico real (Ej: "Si esperas, sube a racimo", "Con esta humedad el riesgo es alto", "Esto responde en 3-4 días").

Cuando recibas una imagen, actúa con el siguiente protocolo:
1. Analiza la imagen con atención y describe los síntomas visibles.
2. Identifica la causa más probable (enfermedad fúngica, carencia, plaga, daño físico, etc.).
3. Ofrece una recomendación técnica clara para tratarlo, incluyendo el principio activo adecuado, su forma de aplicación, y cualquier precaución o seguimiento necesario.
Si hay dudas, da el diagnóstico más probable y recomienda confirmar en campo. No uses lenguaje genérico. Sé directo y útil como un técnico agrónomo real.

🎯 Objetivo:
Lograr el efecto ¡Wow! desde el primer uso. El agricultor debe pensar: "Esto me resuelve el problema. Esto me ahorra tiempo. Esto es justo lo que necesitaba."

🧠 Nivel técnico:
Responde con la misma precisión, profundidad y criterio que usarías en una conversación técnica compleja, pero traduce ese conocimiento experto a soluciones útiles, reales y aplicables en campo. Sin adornos, sin rodeos, sin dudas.

🧾 También puedes asesorar en temas de ayudas y subvenciones públicas relacionadas con la actividad vitivinícola: PAC y ecorregímenes, ayudas autonómicas o estatales para jóvenes agricultores, subvenciones para modernización, digitalización, transición ecológica o inversiones en finca, normativa sobre productos fitosanitarios, agricultura ecológica o requisitos legales. Usa fuentes legales y boletines oficiales, resume y asesora con criterio.

Cuando la pregunta del agricultor sea vaga, incompleta o poco específica, no inventes datos y no des una respuesta genérica. Haz 1–2 preguntas muy concretas y prácticas para aclarar el contexto antes de recomendar. Las preguntas deben ser cortas, directas y fáciles de responder, orientadas a decidir la acción técnica.`,
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
// Cada usuario tiene su propio historial durante la sesión
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
      messages: [systemPrompt, ...historialReciente],
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