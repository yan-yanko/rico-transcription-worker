import express from "express";
import multer from "multer";
import fs from "fs";
import { v2 } from "@google-cloud/speech";
import ffmpeg from "fluent-ffmpeg";

const app = express();
const client = new v2.SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
});

const upload = multer({ dest: "/tmp" });

// אופטימיזציה: המרה לפורמט דחוס יותר (Opus) שגוגל מעבדת מהר יותר
function convertToOptimizedAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('libopus') // Opus הוא הסטנדרט של NotebookLM למהירות
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

app.post("/transcribe", upload.single("file"), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const optimizedPath = `${inputPath}.ogg`;

    // שלב 1: המרה מהירה
    await convertToOptimizedAudio(inputPath, optimizedPath);
    const audioBytes = fs.readFileSync(optimizedPath).toString("base64");

    // שלב 2: שליחה ל-V2 עם מודל latest_long [cite: 3, 13]
    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      config: {
        autoDecodingConfig: {}, // גוגל יזהה אוטומטית שזה Opus
        features: {
          enableAutomaticPunctuation: true, // [cite: 10]
          enableWordTimeOffsets: true, // [cite: 11]
        },
        diarizationConfig: {
          enableSpeakerDiarization: true, // [cite: 12]
          minSpeakerCount: 2,
          maxSpeakerCount: 5,
        },
      },
      content: audioBytes,
    };

    // שימוש ב-recognize סינכרוני לקבצים קצרים (עד 1-2 דקות) למהירות מקסימלית
    const [response] = await client.recognize(request);

    // ניקוי
    fs.unlinkSync(inputPath);
    fs.unlinkSync(optimizedPath);

    return res.json(response);
  } catch (err) {
    console.error("Fast-Transcription failed:", err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Rico High-Speed Worker on ${PORT}`));