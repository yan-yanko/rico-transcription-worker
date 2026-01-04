import express from "express";
import multer from "multer";
import fs from "fs";
import { v2 } from "@google-cloud/speech";
import ffmpeg from "fluent-ffmpeg";

const app = express();
app.use(express.json());

// טעינת מפתח מגוגל - מתוך המשתנה ב-Railway
const credentialsJSON = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const client = new v2.SpeechClient(credentialsJSON ? { credentials: JSON.parse(credentialsJSON) } : {});

const upload = multer({ dest: "/tmp" });

/**
 * פונקציית עזר להמרת אודיו לפורמט WAV תקני
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
 * Endpoint הראשי - עבר לשימוש ב-LongRunningRecognize
 * זה מאפשר לעקוף את מגבלת ה-10MB של בקשות רגילות
 */
app.post("/transcribe", upload.single("file"), async (req, res) => {
  console.log("--- New Long-Running Request ---");

  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const inputPath = req.file.path;
    const wavPath = `${inputPath}.wav`;

    console.log(`Processing file: ${req.file.originalname}`);
    await convertToWav(inputPath, wavPath);

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // הגדרת הבקשה לפי ה-DRP (V2, hebrew-long)
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      config: {
        autoDecodingConfig: {},
      },
      content: audioBytes,
    };

    console.log("Starting Long Running Operation (LRO)...");

    // שימוש בשיטה אסינכרונית - מחזירה אובייקט של הפעולה ולא את התוצאה הסופית מיד
    const [operation] = await client.longRunningRecognize(request);

    // ניקוי קבצים זמניים
    [inputPath, wavPath].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));

    // החזרת ה-Operation Name ללאבל כדי שיוכל לעשות Polling
    return res.json({
      operation: operation.name,
      status: "processing"
    });

  } catch (err) {
    console.error("GCP Error:", err.message);
    return res.status(500).json({ error: "Worker Error", message: err.message });
  }
});

/**
 * Endpoint חדש לבדיקת סטטוס הפעולה
 * לאבבל ישתמש בזה כדי לדעת מתי התמלול הסתיים
 */
app.get("/operation/:name*", async (req, res) => {
  try {
    const operationName = req.params.name + req.params[0];
    const [operation] = await client.checkLongRunningRecognizeProgress(operationName);

    if (operation.done) {
      return res.json({ status: "completed", response: operation.response });
    }

    res.json({ status: "processing", metadata: operation.metadata });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint לבדיקת גרסה עבור לאבבל
app.get("/version", (req, res) => {
  res.json({ handler: "google-stt-v2-lro", status: "ready" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Rico LRO Worker active on ${PORT}`));