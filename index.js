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

    const wavPath = `${req.file.path}.wav`;

    // המרה ל-WAV - מבטיח שגוגל יוכל לפענח את הקובץ בקלות
    await new Promise((resolve, reject) => {
      ffmpeg(req.file.path).audioChannels(1).audioFrequency(16000).format("wav").on("end", resolve).on("error", reject).save(wavPath);
    });

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // התיקון לשגיאת decoding_config:
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      config: {
        // ב-V2, חייבים להגדיר decoding_config מפורש או אוטומטי
        autoDecodingConfig: {},
      },
      content: audioBytes,
    };

    console.log("Sending to V2 Recognizer with autoDecodingConfig...");
    const [response] = await client.recognize(request);

    // ניקוי קבצים
    [req.file.path, wavPath].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));

    // הוספת Header כדי ש-Lovable יזהה שזה ה-Worker החדש (לפי הצעה 3 של לאבבל)
    res.setHeader('X-Worker-Version', 'v2-strict-optimized');
    return res.json(response);

  } catch (err) {
    console.error("GCP Detailed Error:", err);
    return res.status(500).json({
      error: "Worker Error",
      message: err.message,
      code: err.code
    });
  }
});

// Endpoint לבדיקת גרסה (לפי הצעה 3 של לאבבל)
app.get("/version", (req, res) => {
  res.json({ handler: "google-stt-v2-strict", status: "ready" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Rico Worker v2.1 active on ${PORT}`));