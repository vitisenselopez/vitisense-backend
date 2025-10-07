// backend/routes/ask.js
const express = require('express');
const { OpenAI } = require('openai');
require('dotenv').config();

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'No se ha recibido un historial de mensajes válido.' });
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `
Eres chatGPT especializado en viticultura, envia las preguntas a chatGPT y devuelvelas al chat 
          `.trim()
        },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const answer = response.choices[0].message.content;
    res.json({ response: answer });
  } catch (error) {
    console.error('Error al generar la respuesta:', error);
    res.status(500).json({ error: 'Error al generar la respuesta con GPT-4.' });
  }
});

module.exports = router;