import express from "express";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import ffmpeg from "fluent-ffmpeg";

const upload = multer({ dest: "/tmp" });
const app = express();

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

    await convertToWav(inputPath, wavPath);

    const audioBytes = fs.readFileSync(wavPath).toString("base64");

    const response = await fetch(
      `https://speech.googleapis.com/v1/speech:longrunningrecognize?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            languageCode: "he-IL",
            audioChannelCount: 1,
            enableAutomaticPunctuation: true
          },
          audio: { content: audioBytes }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data });
    }

    return res.json({
      status: "transcription_started",
      operation: data.name
    });
  } catch (err) {
    return res.status(500).json({
      error: "Transcription failed",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Transcription worker running on port", PORT);
});
