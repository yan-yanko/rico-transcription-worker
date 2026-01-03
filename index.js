import express from "express";
import multer from "multer";
import fs from "fs";
import { SpeechClient } from "@google-cloud/speech";
import ffmpeg from "fluent-ffmpeg";

/**
 * Rico Backend Worker
 * אסטרטגיה: Hebrew-First Transcription (V2 SDK)
 */

// 1. הגדרת ה-Credentials מתוך משתנה הסביבה ב-Railway
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

// 2. יצירת הלקוח בגרסת V2 (נדרש עבור Recognizers ומודל latest_long)
// נעשה שימוש ב-SpeechClient.v2 כפי שמוגדר ב-DRP
const client = new SpeechClient.v2.SpeechClient(clientOptions);

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
 * מקבל קובץ, ממיר אותו ושולח ל-Google Speech V2
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
    fs.unlinkSync(inputPath);
    fs.unlinkSync(wavPath);

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
 * משתמשת ב-Recognizer הייעודי: hebrew-long
 */
async function transcribeAudio(audioBytes) {
  const request = {
    // שימוש בנתיב ה-Recognizer המלא מה-DRP
    recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
    config: {
      autoDecodingConfig: {},
      features: {
        enableAutomaticPunctuation: true, // פיסוק אוטומטי [cite: 10]
        enableWordTimeOffsets: true,     // Word-level timestamps [cite: 11]
      },
      diarizationConfig: {
        enableSpeakerDiarization: true, // זיהוי דוברים [cite: 12]
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