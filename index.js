import express from "express";

const app = express();
app.use(express.json());

app.post("/transcribe", async (req, res) => {
  return res.json({ status: "worker alive" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Transcription worker running on port", PORT);
});
