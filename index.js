import express from "express";
import multer from "multer";
import fs from "fs";

const upload = multer({ dest: "/tmp" });
const app = express();

app.post("/transcribe", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  return res.json({
    status: "file received",
    filename: req.file.originalname,
    size: req.file.size
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Transcription worker running on port", PORT);
});
