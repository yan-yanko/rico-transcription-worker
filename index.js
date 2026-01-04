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
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const wavPath = `${req.file.path}.wav`;
    await convertToWav(req.file.path, wavPath);
    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // ב-V2, עבור קבצים ארוכים משתמשים ב-batchRecognize
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      // ב-batchRecognize שולחים תוכן דרך inlineBatchConfig
      content: audioBytes,
    };

    console.log("Starting V2 Batch Recognition (LRO)...");

    // זו הפונקציה הנכונה ב-V2 שמחזירה Operation
    const [operation] = await client.batchRecognize(request);

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

// בדיקת סטטוס ב-V2
app.get("/operation/:name*", async (req, res) => {
  try {
    const operationName = req.params.name + req.params[0];
    // ב-V2 ניגשים לסטטוס דרך ה-operations client הכללי
    const [operation] = await client.checkBatchRecognizeProgress(operationName);

    if (operation.done) {
      return res.json({ status: "completed", response: operation.response });
    }
    res.json({ status: "processing" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Rico V2-LRO Worker active on ${PORT}`));