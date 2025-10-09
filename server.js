// backend/server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const authRoutes = require("./routes/auth");
const askRoutes = require("./routes/ask");
const conversationRoutes = require("./routes/conversations");
const messageRoutes = require("./routes/message");
const stripeRoutes = require("./routes/stripe");
const stripeWebhook = require("./routes/webhook"); // 🔄 Nuevo

const app = express();
const PORT = process.env.PORT || 3010;

// ⚠️ Webhook necesita express.raw() antes de express.json()
app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

// Middlewares
const allowedOrigins = [
  "http://localhost:5173",
  "https://vitisense-frontend.vercel.app",
  "https://vitisense.es", // ← cámbialo por tu dominio real si lo usas
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("No permitido por CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json()); // Debe ir después del webhook
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Rutas principales
app.use("/api/auth", authRoutes);
app.use("/api/ask", askRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/stripe", stripeRoutes); // checkout y demás

// Fallback para rutas inexistentes
app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

app.listen(PORT, () => {
  console.log(`✅ Backend VITISENSE corriendo en http://localhost:${PORT}`);
});