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
  console.log("--- Starting Batch Transcription (Final Protocol) ---");

  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const wavPath = `${req.file.path}.wav`;
    await convertToWav(req.file.path, wavPath);
    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // המבנה המדויק ל-BatchRecognize בגרסה V2
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      files: [
        {
          content: audioBytes
        }
      ],
      // פתרון השגיאה הנוכחית: הגדרת יעד הפלט כ-Inline
      recognitionOutputConfig: {
        inlineResponseConfig: {}
      },
      // הגדרות עיבוד נוספות למהירות ודיוק
      processingStrategy: 'DYNAMIC_BATCHING'
    };

    console.log("Sending BatchRecognize with inlineResponseConfig...");
    const [operation] = await client.batchRecognize(request);

    // ניקוי קבצים
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
      // ב-V2 Inline, התוצאה נמצאת בתוך inline_result של הקובץ הראשון
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
app.listen(PORT, '0.0.0.0', () => console.log(`Rico Final V2 Worker active on ${PORT}`));