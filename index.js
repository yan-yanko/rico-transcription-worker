import express from "express";
import multer from "multer";
import fs from "fs";
import { v2 } from "@google-cloud/speech";
import ffmpeg from "fluent-ffmpeg";

const app = express();
app.use(express.json());

const credentialsJSON = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const client = new v2.SpeechClient(credentialsJSON ? { credentials: JSON.parse(credentialsJSON) } : {});

const upload = multer({ dest: "/tmp" });

app.post("/transcribe", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    const inputPath = req.file.path;
    const wavPath = `${inputPath}.wav`;

    // המרה ל-WAV
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath).audioChannels(1).audioFrequency(16000).format("wav").on("end", resolve).on("error", reject).save(wavPath);
    });

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // תיקון קריטי ל-V2: כשמשתמשים ב-Recognizer מוכן, שולחים רק תוכן
    // גוגל כבר יודע את ה-config מה-Recognizer hebrew-long
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      content: audioBytes,
    };

    console.log("Requesting transcription from V2 Recognizer...");
    const [response] = await client.recognize(request);

    // ניקוי
    [inputPath, wavPath].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));

    return res.json(response);

  } catch (err) {
    console.error("GCP Error Details:", err);
    return res.status(500).json({
      error: "Worker Error",
      message: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Worker active on ${PORT}`));