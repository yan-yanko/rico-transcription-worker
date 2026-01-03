import express from "express";
import multer from "multer";
import fs from "fs";
import { v2 } from "@google-cloud/speech"; 
import ffmpeg from "fluent-ffmpeg";

const app = express();
app.use(express.json());

// טעינת Credentials מ-Railway
const credentialsJSON = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
let clientOptions = {};

if (credentialsJSON) {
  try {
    clientOptions.credentials = JSON.parse(credentialsJSON);
  } catch (e) {
    console.error("Auth Error:", e.message);
  }
}

const client = new v2.SpeechClient(clientOptions);
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
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const inputPath = req.file.path;
    const wavPath = `${inputPath}.wav`;

    console.log(`Processing: ${req.file.originalname}`);
    await convertToWav(inputPath, wavPath);

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // תיקון קריטי: אנחנו מתעלמים מה-req.body (מה ש-Lovable שולח)
    // ומשתמשים רק בקונפיגורציה המאושרת של Rico לפי ה-DRP
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      config: {
        autoDecodingConfig: {},
        features: {
          enableAutomaticPunctuation: true, // [cite: 10]
          enableWordTimeOffsets: true,     // [cite: 11]
        },
        diarizationConfig: {
          enableSpeakerDiarization: true, // [cite: 12]
          minSpeakerCount: 2,
          maxSpeakerCount: 6,
        },
      },
      content: audioBytes,
    };

    console.log("Sending request to Google V2...");
    const [response] = await client.recognize(request);
    
    // ניקוי קבצים
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);

    return res.json(response);
  } catch (err) {
    console.error("Worker Error:", err.message);
    return res.status(500).json({
      error: "Transcription failed",
      details: err.message // כאן נראה בדיוק מה גוגל אומרת
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Rico Worker Active on port ${PORT}`);
});