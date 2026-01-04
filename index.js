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

app.post("/transcribe", upload.single("file"), async (req, res) => {
  console.log("--- Starting Batch Transcription Request ---");

  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const wavPath = `${req.file.path}.wav`;
    await convertToWav(req.file.path, wavPath);
    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // תיקון קריטי: המבנה המדויק ש-BatchRecognize דורשת עבור Inline Content
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      processingStrategy: 'DYNAMIC_BATCHING', // אופטימיזציה למהירות
      files: [
        {
          content: audioBytes // שליחת התוכן ישירות בתוך מערך הקבצים
        }
      ],
      // הגדרת קונפיגורציה בסיסית אם ה-Recognizer דורש זאת
      recognitionConfig: {
        autoDecodingConfig: {}
      }
    };

    console.log("Sending BatchRecognize request to Google...");
    const [operation] = await client.batchRecognize(request);

    // ניקוי
    [req.file.path, wavPath].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));

    return res.json({
      operation: operation.name,
      status: "processing"
    });

  } catch (err) {
    console.error("GCP Detailed Error:", err);
    return res.status(500).json({ error: "Worker Error", message: err.message });
  }
});

app.get("/operation/:name*", async (req, res) => {
  try {
    const operationName = req.params.name + req.params[0];
    const [operation] = await client.checkBatchRecognizeProgress(operationName);

    if (operation.done) {
      // ב-Batch V2 התוצאה נמצאת תחת results של הקובץ הראשון
      const results = operation.response?.results || {};
      return res.json({ status: "completed", response: results });
    }
    res.json({ status: "processing" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Rico Batch-Inline Worker active on ${PORT}`));