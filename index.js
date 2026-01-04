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
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const wavPath = `${req.file.path}.wav`;
    // המרה ל-WAV (16kHz, Mono) - מבטיח תאימות מקסימלית ל-V2
    await new Promise((resolve, reject) => {
      ffmpeg(req.file.path).audioChannels(1).audioFrequency(16000).format("wav").on("end", resolve).on("error", reject).save(wavPath);
    });

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // תיקון מבנה ה-Request עבור BatchRecognize V2 Inline
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      files: [
        {
          // ב-V2 חובה להגדיר content בתוך אובייקט הקובץ
          content: audioBytes
        }
      ],
      recognitionOutputConfig: {
        inlineResponseConfig: {}
      },
      processingStrategy: 'DYNAMIC_BATCHING'
    };

    console.log("Sending BatchRecognize request...");
    const [operation] = await client.batchRecognize(request);

    // ניקוי קבצים
    [req.file.path, wavPath].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));

    return res.json({
      operation: operation.name,
      status: "processing"
    });

  } catch (err) {
    console.error("GCP Error:", err.message);
    return res.status(500).json({ error: "Worker Error", message: err.message });
  }
});

// אחידות בבדיקת הסטטוס
app.get("/operation/:name*", async (req, res) => {
  try {
    const operationName = req.params.name + req.params[0];
    const [operation] = await client.checkBatchRecognizeProgress(operationName);

    if (operation.done) {
      // חילוץ התוצאות מהמבנה המורכב של V2 Batch
      const results = operation.response?.results;
      const firstFileResult = results ? Object.values(results)[0] : null;

      return res.json({
        status: "completed",
        response: firstFileResult?.inlineResult || {}
      });
    }
    res.json({ status: "processing" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Rico Worker V2.5 Active`));