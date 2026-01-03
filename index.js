import express from "express";
import multer from "multer";
import fs from "fs";
import { v2 } from "@google-cloud/speech";
import ffmpeg from "fluent-ffmpeg";

const app = express();
// תמיכה גם ב-JSON וגם ב-Urlencoded למקרה ש-Lovable משנה פורמט
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const credentialsJSON = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const client = new v2.SpeechClient(credentialsJSON ? { credentials: JSON.parse(credentialsJSON) } : {});

const upload = multer({ dest: "/tmp" });

app.post("/transcribe", upload.single("file"), async (req, res) => {
  console.log("--- New Transcription Request ---");

  try {
    // בדיקה אם הקובץ הגיע - אם לא, נבדוק אם הוא נשלח תחת שם שדה אחר
    const file = req.file;
    if (!file) {
      console.error("No file found in request. Body:", req.body);
      return res.status(400).json({ error: "No file uploaded. Make sure to use 'file' field name." });
    }

    const inputPath = file.path;
    const wavPath = `${inputPath}.wav`;

    // המרה ל-WAV (Mono, 16kHz) - הסטנדרט הכי בטוח לדיוק
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioChannels(1)
        .audioFrequency(16000)
        .format("wav")
        .on("end", resolve)
        .on("error", reject)
        .save(wavPath);
    });

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    // קונפיגורציה קשיחה לפי ה-DRP - מתעלמים מכל מה ש-Lovable שלח ב-Body
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      config: {
        autoDecodingConfig: {},
        features: {
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
        },
        diarizationConfig: {
          enableSpeakerDiarization: true,
          minSpeakerCount: 2,
          maxSpeakerCount: 6,
        },
      },
      content: audioBytes,
    };

    const [response] = await client.recognize(request);

    // ניקוי
    [inputPath, wavPath].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));

    console.log("Transcription successful!");
    return res.json(response);

  } catch (err) {
    console.error("DETAILED ERROR:", err);
    return res.status(500).json({
      error: "Worker Error",
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Rico Worker up on ${PORT}`));