import express from "express";
import multer from "multer";
import fs from "fs";
import { v2 } from "@google-cloud/speech"; // ייבוא ישיר של גרסה v2
import ffmpeg from "fluent-ffmpeg";

/**
 * Rico Backend Worker
 * [cite_start]אסטרטגיה: Hebrew-First Transcription (V2 SDK) [cite: 3, 4]
 */

[cite_start]// 1. הגדרת ה-Credentials מתוך משתנה הסביבה ב-Railway [cite: 9]
const credentialsJSON = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
let clientOptions = {};

if (credentialsJSON) {
  try {
    // הפיכת טקסט ה-JSON לאובייקט כדי למנוע שגיאת "Could not load default credentials"
    clientOptions.credentials = JSON.parse(credentialsJSON);
  } catch (e) {
    console.error("CRITICAL: Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:", e.message);
  }
}

[cite_start]// 2. יצירת הלקוח בגרסת V2 כפי שמוגדר באסטרטגיית ה-DRP [cite: 9]
const client = new v2.SpeechClient(clientOptions);

const upload = multer({ dest: "/tmp" });
const app = express();
app.use(express.json());

/**
 * פונקציית עזר להמרת אודיו לפורמט WAV תקני (Mono, 16kHz)
 */
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

/**
 * ה-Endpoint הראשי לתמלול
 * [cite_start]מקבל קובץ, ממיר אותו ושולח ל-Google Speech V2 [cite: 9]
 */
app.post("/transcribe", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const inputPath = req.file.path;
    const wavPath = `${inputPath}.wav`;

    console.log(`Starting conversion for: ${req.file.originalname}`);
    await convertToWav(inputPath, wavPath);

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    const response = await transcribeAudio(audioBytes);
    
    // ניקוי קבצים זמניים
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);

    return res.json(response);
  } catch (err) {
    console.error("Transcription Error:", err.message);
    return res.status(500).json({
      error: "Transcription failed",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Rico Transcription Worker running on port", PORT);
});

/**
 * פונקציית הליבה לתמלול מול Google Cloud V2
 * [cite_start]משתמשת ב-Recognizer הייעודי: hebrew-long [cite: 10]
 */
async function transcribeAudio(audioBytes) {
  const request = {
    [cite_start]// שימוש בנתיב ה-Recognizer המלא מה-DRP [cite: 10]
    recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
    config: {
      autoDecodingConfig: {},
      features: {
        [cite_start]enableAutomaticPunctuation: true, // פיסוק אוטומטי [cite: 11]
        [cite_start]enableWordTimeOffsets: true,     // Word-level timestamps [cite: 12]
      },
      diarizationConfig: {
        [cite_start]enableSpeakerDiarization: true, // זיהוי דוברים [cite: 13]
        minSpeakerCount: 2,
        maxSpeakerCount: 6,
      },
    },
    content: audioBytes,
  };

  // שליחת הבקשה ל-Google Cloud
  const [response] = await client.recognize(request);

  return response;
}