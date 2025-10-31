const express = require("express");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

// 🔧 Helpers dinámicos basados en la ruta establecida en server.js
const getConversationsPath = (req) => req.app.get("conversationsDir");
const getUserFile = (req, email) => path.join(getConversationsPath(req), `${email}.json`);

const loadConversations = (req, email) => {
  const filePath = getUserFile(req, email);
  if (!fs.existsSync(filePath)) return { conversations: [] };
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
};

const saveConversations = (req, email, conversations) => {
  const filePath = getUserFile(req, email);
  fs.writeFileSync(filePath, JSON.stringify({ conversations }, null, 2));
};

// ✅ GET todas las conversaciones de un usuario
router.get("/:email", (req, res) => {
  try {
    const conversations = loadConversations(req, req.params.email);
    res.json(conversations); // { conversations: [...] }
  } catch (err) {
    console.error("❌ Error al leer conversaciones:", err);
    res.status(500).json({ error: "Error al leer conversaciones" });
  }
});

// ✅ POST nueva conversación vacía
router.post("/", (req, res) => {
  try {
    const { email } = req.body;
    const all = loadConversations(req, email);
    const newConversation = {
      id: uuidv4(),
      title: "Conversación nueva",
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    all.conversations.unshift(newConversation);
    saveConversations(req, email, all.conversations);
    res.json({ conversation: newConversation });
  } catch (err) {
    console.error("❌ Error al crear conversación:", err);
    res.status(500).json({ error: "Error al crear conversación" });
  }
});

// ✅ PUT añadir mensajes
router.put("/:email/:id", (req, res) => {
  try {
    const { email, id } = req.params;
    const { messages } = req.body;
    const all = loadConversations(req, email);
    const conv = all.conversations.find((c) => c.id === id);
    if (!conv) return res.status(404).json({ error: "No encontrada" });
    conv.messages = messages;
    conv.updatedAt = new Date().toISOString();
    saveConversations(req, email, all.conversations);
    res.json({ conversation: conv });
  } catch (err) {
    console.error("❌ Error al actualizar conversación:", err);
    res.status(500).json({ error: "Error al actualizar conversación" });
  }
});

// ✅ PUT cambiar título
router.put("/:email/:id/title", (req, res) => {
  try {
    const { email, id } = req.params;
    const { newTitle } = req.body;
    const all = loadConversations(req, email);
    const conv = all.conversations.find((c) => c.id === id);
    if (!conv) return res.status(404).json({ error: "No encontrada" });
    conv.title = newTitle;
    saveConversations(req, email, all.conversations);
    res.json({ conversation: conv });
  } catch (err) {
    console.error("❌ Error al editar título:", err);
    res.status(500).json({ error: "Error al editar" });
  }
});

// ✅ DELETE conversación
router.delete("/:email/:id", (req, res) => {
  try {
    const { email, id } = req.params;
    const all = loadConversations(req, email);
    const updatedConversations = all.conversations.filter((c) => c.id !== id);
    saveConversations(req, email, updatedConversations);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al borrar conversación:", err);
    res.status(500).json({ error: "Error al borrar" });
  }
});

module.exports = router;