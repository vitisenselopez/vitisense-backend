// backend/routes/upload.js
import express from "express";
import multer from "multer";
import cloudinary from "../utils/cloudinary.js";
import fs from "fs";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.post("/", upload.single("image"), async (req, res) => {
  try {
    const filePath = req.file.path;

    // Subir a Cloudinary
    const result = await cloudinary.uploader.upload(filePath, {
      folder: "vitisense-chat",
    });

    // Eliminar archivo local tras subirlo
    fs.unlinkSync(filePath);

    return res.status(200).json({ imageUrl: result.secure_url });
  } catch (error) {
    console.error("Error subiendo imagen:", error);
    return res.status(500).json({ error: "Error al subir la imagen" });
  }
});

export default router;