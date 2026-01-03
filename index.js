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
    if (!req.file) return res.status(400).json({ error: "No file" });

    const wavPath = `${req.file.path}.wav`;

    // המרה ל-WAV לדיוק מקסימלי [cite: 1, 4]
    await new Promise((resolve, reject) => {
      ffmpeg(req.file.path).audioChannels(1).audioFrequency(16000).format("wav").on("end", resolve).on("error", reject).save(wavPath);
    });

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    const request = {
      recognizer: "projects/rico-482513/locations/global/recognizers/hebrew-long",
      config: { autoDecodingConfig: {} },
      content: audioBytes,
    };

    console.log("Starting transcription...");
    const [response] = await client.recognize(request);

    // ניקוי קבצים
    [req.file.path, wavPath].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));

    // כאן התיקון! אנחנו בונים אובייקט ש"מרמה" את Lovable ונותן לו את הטקסט מיד
    // במקום לשלוח אותו לחפש מזהה פעולה שלא קיים
    return res.json({
      name: "immediate_sync_op", // מזהה דמי כדי שלאבבל לא יתלונן
      done: true,
      response: response,
      // הזרקת הטקסט ישירות למקום שבו לאבבל מחפש אותו
      transcript: response.results?.map(r => r.alternatives?.[0]?.transcript).join("\n") || ""
    });

  } catch (err) {
    console.error("GCP Error:", err.message);
    return res.status(500).json({ error: "Worker Error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Worker v2.3 Sync-to-Async-Shim active`));