import express from "express";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import { SpeechClient } from "@google-cloud/speech";

const client = new SpeechClient();
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


    const response = await transcribeAudio(audioBytes);

    return res.json(response);
  } catch (err) {
    return res.status(500).json({
      error: "Transcription failed",
      details: err.message
    });
  }
});

app.get("/transcribe/:operationId", async (req, res) => {
  try {
    const { operationId } = req.params;

    const response = await fetch(
      `https://speech.googleapis.com/v1/operations/${operationId}?key=${process.env.GOOGLE_API_KEY}`
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        status: "failed",
        error: data,
      });
    }

    // עדיין בעיבוד
    if (!data.done) {
      return res.json({
        status: "processing",
      });
    }

    // הסתיים אבל נכשל
    if (data.error) {
      return res.status(500).json({
        status: "failed",
        error: data.error,
      });
    }

    // הצלחה – חילוץ הטקסט
    const transcript =
      data.response.results
        ?.map(r => r.alternatives?.[0]?.transcript)
        .join(" ") || "";

    res.json({
      status: "completed",
      transcript,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch transcription result" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Transcription worker running on port", PORT);
});

export async function transcribeAudio(audioBytes) {
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

  return response;
}
