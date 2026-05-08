const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");

const encodeToken = require("./encrypt");
const { getToken, clearTokens } = require("./auth");

const app = express();

app.set("trust proxy", 1);

app.use(express.json());
app.use(helmet());
app.use(cors());

/**
 * ENV CHECK
 */
const required = [
  "AES_KEY",
  "AES_IV"
];

for (const k of required) {
  if (!process.env[k]) {
    throw new Error(`Missing env: ${k}`);
  }
}

/**
 * RATE LIMITERS
 */
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * HEALTH
 */
app.get("/status/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * GENERATE
 */
app.post("/generate", generateLimiter, async (req, res) => {
  try {
    const prompt = req.body.prompt || "a dog and a guy";
    const ratio = req.body.ratio || "9:16";

    if (prompt.length > 1000) {
      return res.status(400).json({
        error: "Prompt too long"
      });
    }

    const allowedRatios = ["9:16", "16:9", "1:1"];

    if (!allowedRatios.includes(ratio)) {
      return res.status(400).json({
        error: "Invalid ratio"
      });
    }

    const token = await getToken();

    const encToken = encodeToken(token);

    const form = new FormData();

    form.append("prompt", prompt);
    form.append("model", "veo-3");
    form.append("duration", "8");
    form.append("resolution", "720p");
    form.append("aspect_ratio", ratio);

    const r = await axios.post(
      "https://api.geminigen.ai/mobile/v2/video-gen",
      form,
      {
        timeout: 60000,
        headers: {
          ...form.getHeaders(),
          authorization: `Bearer ${encToken}`,
          "user-agent": "Dart/3.8 (dart:io)"
        }
      }
    );

    const taskId = r.data.uuid;

    res.json({
      creator: "@Thrynnex",
      task_id: taskId,
      task_url: `${req.protocol}://${req.get("host")}/status/${taskId}`
    });

  } catch (e) {

    console.error("GENERATE ERROR");

    if (e.response) {
      console.error(e.response.status);
      console.error(e.response.data);

      if (e.response.status === 401) {
        clearTokens();
      }

    } else {
      console.error(e.message);
    }

    res.status(500).json({
      creator: "@Thrynnex",
      error: "Failed to start generation"
    });
  }
});

/**
 * STATUS
 */
app.get("/status/:uuid", statusLimiter, async (req, res) => {

  try {

    const token = await getToken();

    const r = await axios.get(
      `https://api.geminigen.ai/mobile/v1/history/${req.params.uuid}`,
      {
        timeout: 60000,
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": "Dart/3.8 (dart:io)"
        }
      }
    );

    const data = r.data;

    let statusText = "started";

    if (data.status === 2) statusText = "done";
    if (data.status === 3) statusText = "failed";

    const videoUrl =
      data.generated_video?.[0]?.video_url || null;

    res.json({
      creator: "@Thrynnex",
      status: statusText,
      video_url: videoUrl,
      download_url: videoUrl
    });

  } catch (e) {

    console.error("STATUS ERROR");

    if (e.response) {
      console.error(e.response.status);
      console.error(e.response.data);

      if (e.response.status === 401) {
        clearTokens();
      }

    } else {
      console.error(e.message);
    }

    res.status(500).json({
      creator: "@Thrynnex",
      status: "failed",
      video_url: null,
      download_url: null
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
