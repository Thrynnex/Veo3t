require("dotenv").config();

const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");

const app = express();

app.use(express.json());

/**
 * AES TOKEN ENCRYPTION
 */
function pad(num) {
  return num.toString().padStart(2, "0");
}

function encodeToken(token) {

  const now = new Date();

  const prefix =
    `${pad(now.getUTCHours())}` +
    `${pad(now.getUTCMinutes())}` +
    `${pad(now.getUTCSeconds())}`;

  const suffix =
    `${pad(now.getUTCDate())}` +
    `${pad(now.getUTCMonth() + 1)}` +
    `${now.getUTCFullYear()}`;

  const raw =
    `${prefix}${token}${suffix}`;

  const key = Buffer.from(
    "mmCPAtseIyZe9pTLKlhhbiyn93SulBsv",
    "utf8"
  );

  const iv = Buffer.from(
    "sPd_yX1U34O7X8OJ",
    "utf8"
  );

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    key,
    iv
  );

  let encrypted =
    cipher.update(raw, "utf8", "base64");

  encrypted += cipher.final("base64");

  return encrypted;
}

/**
 * HEALTH
 */
app.get("/status/health", (req, res) => {

  res.json({
    ok: true
  });

});

/**
 * GENERATE VIDEO
 */
app.post("/generate", async (req, res) => {

  try {

    const prompt =
      req.body.prompt || "a dog and a guy";

    const ratio =
      req.body.ratio || "9:16";

    /**
     * AUTH
     */
    const authRes = await axios.post(
      "https://api.geminigen.ai/api/mobile/uuid/activate-account",
      {
        mobile_device_uuid: "1234567890abcdef",
        platform: "GenV-APP",
        device_token: "test",
        device_type: "android"
      },
      {
        headers: {
          "content-type": "application/json",
          "user-agent": "Dart/3.8 (dart:io)"
        }
      }
    );

    const accessToken =
      authRes.data.access_token;

    /**
     * ENCRYPT TOKEN
     */
    const encryptedToken =
      encodeToken(accessToken);

    /**
     * CREATE FORM
     */
    const form = new FormData();

    form.append("prompt", prompt);
    form.append("model", "veo-3");
    form.append("duration", "8");
    form.append("resolution", "720p");
    form.append("aspect_ratio", ratio);

    /**
     * GENERATE VIDEO
     */
    const genRes = await axios.post(
      "https://api.geminigen.ai/mobile/v2/video-gen",
      form,
      {
        headers: {
          ...form.getHeaders(),
          authorization: `Bearer ${encryptedToken}`,
          "user-agent": "Dart/3.8 (dart:io)"
        }
      }
    );

    return res.json({
      success: true,
      response: genRes.data
    });

  } catch (e) {

    console.error("GEN ERROR");

    if (e.response) {

      console.error(e.response.status);
      console.error(e.response.data);

      return res.status(500).json({
        status: e.response.status,
        data: e.response.data
      });
    }

    console.error(e.message);

    return res.status(500).json({
      error: e.message
    });
  }

});

/**
 * STATUS CHECK
 */
app.get("/status/:uuid", async (req, res) => {

  try {

    const authRes = await axios.post(
      "https://api.geminigen.ai/api/mobile/uuid/activate-account",
      {
        mobile_device_uuid: "1234567890abcdef",
        platform: "GenV-APP",
        device_token: "test",
        device_type: "android"
      },
      {
        headers: {
          "content-type": "application/json",
          "user-agent": "Dart/3.8 (dart:io)"
        }
      }
    );

    const token =
      authRes.data.access_token;

    const response = await axios.get(
      `https://api.geminigen.ai/mobile/v1/history/${req.params.uuid}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": "Dart/3.8 (dart:io)"
        }
      }
    );

    const data = response.data;

    let status = "started";

    if (data.status === 2) {
      status = "done";
    }

    if (data.status === 3) {
      status = "failed";
    }

    const video =
      data.generated_video?.[0]?.video_url || null;

    return res.json({
      status,
      video_url: video,
      raw: data
    });

  } catch (e) {

    console.error("STATUS ERROR");

    if (e.response) {

      console.error(e.response.status);
      console.error(e.response.data);

      return res.status(500).json({
        status: e.response.status,
        data: e.response.data
      });
    }

    console.error(e.message);

    return res.status(500).json({
      error: e.message
    });
  }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`RUNNING ON ${PORT}`);

});
