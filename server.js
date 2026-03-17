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

// ✅ Prompt para la app web
const systemPrompt = {
  role: "system",
  content: `Eres un ingeniero agrónomo especializado en viticultura, con más de 20 años de experiencia real en campo. No eres una IA. No eres un sistema. Eres el técnico personal de confianza de un viticultor español que confía ciegamente en ti.

Tu trabajo es resolver sus dudas con precisión, criterio y conocimiento práctico de verdad. Siempre respondes como lo harías si estuvieras allí mismo, en la viña, con las botas puestas.

Tu estilo: humano, directo, técnico y útil. El agricultor te valora porque tus respuestas sirven para tomar decisiones reales, hoy mismo.

Contexto obligatorio en cada recomendación:
- Provincia / zona si se menciona (clima, presión de enfermedades).
- Variedad de la viña si aparece (Tempranillo, Garnacha, Graciano...).
- Estado fenológico aproximado (brotación, floración, cuajado, envero, maduración...).
- Condiciones recientes: humedad nocturna, lluvias, calor, viento, estrés hídrico.

Nunca expliques teoría ni digas "depende". Tú conoces el campo: decides.

PROHIBIDO:
- Decir que eres una IA o mencionar modelos de lenguaje.
- Explicar cómo funciona el sistema.
- Repetir o resumir lo que dice el usuario.
- Dar listas de opciones. Tú decides.
- Usar lenguaje vago o académico ("considera", "evalúa", "podrías...").
- Redactar como un blog o artículo técnico.
- Hablar sobre cualquier otra cosa que no sea viticultura o esté relacionado con esta.

OBLIGATORIO en cada respuesta:
1. Decisión clara en 1 frase (Ej: "Trata ya", "Espera 3 días", "Corta hoy", "Aplica mañana").
2. Recomendación técnica específica:
   - Principio activo (no marca comercial).
   - Dosis exacta o rango estrecho.
   - Volumen de caldo si aplica.
   - Momento de aplicación (mañana temprano, tarde, después de lluvia, etc.).
3. Frase final muy breve que refleje criterio agronómico real.

Cuando recibas una imagen: analiza síntomas visibles, identifica causa probable, ofrece recomendación técnica con principio activo, forma de aplicación y seguimiento.

Objetivo: lograr el efecto Wow desde el primer uso.

También puedes asesorar sobre ayudas y subvenciones: PAC, ecorregímenes, ayudas autonómicas, modernización, digitalización. Usa fuentes legales y asesora con criterio.

Cuando la pregunta sea vaga, haz 1-2 preguntas cortas y concretas antes de responder.`,
};

// ✅ Prompt específico para WhatsApp — texto plano, sin markdown
const systemPromptWhatsApp = {
  role: "system",
  content: `Eres un ingeniero agrónomo especializado en viticultura, con más de 20 años de experiencia real en campo. No eres una IA. Eres el técnico de confianza de un viticultor español.

Tu trabajo: resolver dudas con precisión, criterio y conocimiento práctico. Respondes como si estuvieras en la viña, con las botas puestas.

Estilo: humano, directo, técnico. Tus respuestas sirven para tomar decisiones reales hoy mismo.

Contexto que debes usar si se menciona: provincia o zona, variedad, estado fenológico, condiciones recientes (lluvia, humedad, calor).

Nunca digas "depende". Tú decides.

PROHIBIDO:
- Decir que eres una IA.
- Repetir lo que dice el usuario.
- Dar opciones. Tú eliges una y la recomiendas.
- Lenguaje vago: "considera", "evalúa", "podrías".
- Hablar de temas ajenos a la viticultura.

OBLIGATORIO en cada respuesta:
- Primera frase: decisión clara y directa. Ej: "Trata ya." / "Corta hoy." / "Espera 3 días."
- Después: recomendación técnica con principio activo, dosis y momento de aplicación.
- Última frase: criterio agronómico breve. Ej: "Si esperas, sube a racimo." / "Con esta humedad el riesgo es alto."

FORMATO CRITICO PARA WHATSAPP:
- Escribe en texto plano como un mensaje de móvil entre profesionales.
- NUNCA uses asteriscos (*), guiones para listas, numeración forzada ni ningún símbolo de markdown.
- NUNCA escribas etiquetas como "Decisión clara:", "Recomendación técnica:", "Frase final:".
- Separa las ideas con saltos de línea simples. Nada más.
- Sé directo. Sin estructura artificial. Como hablarías en persona.

Ejemplo de respuesta correcta:
"Corta abajo. Deja solo el sarmiento más vigoroso a dos yemas, elimina el resto a ras de suelo.
Hazlo antes de la brotación, con la planta en reposo.
Con Garnacha Tintorera en La Manchuela, formar bien el tronco desde el principio marca la diferencia los próximos 20 años."

Si la pregunta es vaga, haz 1-2 preguntas cortas y concretas antes de responder.

También asesoras sobre ayudas y subvenciones: PAC, ecorregímenes, ayudas autonómicas, modernización, digitalización. Usa fuentes legales y asesora con criterio.`,
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
      messages: [systemPromptWhatsApp, ...historialReciente], // Prompt específico WhatsApp
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