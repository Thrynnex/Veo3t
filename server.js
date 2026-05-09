require("dotenv").config();

const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");

const app = express();

app.use(express.json());

/**
 * TOKEN FILE MEMORY
 */
let savedToken = null;

/**
 * GENERATE RANDOM DEVICE ID
 */
function getDeviceID() {

  const chars = "0123456789abcdef";

  let uuid = "";

  for (let i = 0; i < 16; i++) {

    uuid += chars[
      Math.floor(Math.random() * chars.length)
    ];
  }

  return uuid;
}

/**
 * RANDOM STRING
 */
const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function randomString(length) {

  const bytes = crypto.randomBytes(length);

  let result = "";

  for (let i = 0; i < length; i++) {

    result += CHARS[
      bytes[i] % CHARS.length
    ];
  }

  return result;
}

/**
 * FCM TOKEN
 */
function generateAndroidFcmToken() {

  const left =
    randomString(22);

  const right =
    "APA91b" + randomString(134);

  return `${left}:${right}`;
}

/**
 * GET AUTH TOKEN
 */
async function getValidToken() {

  if (savedToken) {
    return savedToken;
  }

  const authPayload = {

    mobile_device_uuid:
      getDeviceID(),

    platform: "GenV-APP",

    device_token:
      generateAndroidFcmToken(),

    device_type: "android"
  };

  const authRes = await axios.post(
    "https://api.geminigen.ai/api/mobile/uuid/activate-account",
    authPayload,
    {
      headers: {
        "user-agent": "Dart/3.9 (dart:io)",
        "content-type": "application/json"
      }
    }
  );

  savedToken =
    `Bearer ${authRes.data.access_token}`;

  return savedToken;
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
      req.body.prompt ||
      "a dog and a guy";

    const ratio =
      req.body.ratio ||
      "16:9";

    const authToken =
      await getValidToken();

    /**
     * CREATE FORM
     */
    const form = new FormData();

    form.append("prompt", prompt);

    form.append(
      "model",
      "veo-3.1-lite"
    );

    form.append(
      "duration",
      "8"
    );

    form.append(
      "resolution",
      "720p"
    );

    form.append(
      "aspect_ratio",
      ratio
    );

    form.append(
      "service_mode",
      "stable"
    );

    /**
     * GENERATE
     */
    const genRes = await axios.post(
      "https://api.geminigen.ai/mobile/v3/video-gen",
      form,
      {
        headers: {
          ...form.getHeaders(),
          authorization: authToken,
          "user-agent":
            "Dart/3.9 (dart:io)"
        }
      }
    );

    if (!genRes.data?.uuid) {

      return res.status(500).json({
        error:
          "No task UUID returned",
        raw: genRes.data
      });
    }

    /**
     * SUCCESS
     */
    return res.json({
      success: true,
      task_id: genRes.data.uuid,
      task_url:
        `${req.protocol}://${req.get("host")}/status/${genRes.data.uuid}`
    });

  } catch (err) {

    console.error("GENERATE ERROR");

    if (err.response) {

      console.error(err.response.status);

      console.error(err.response.data);

      return res.status(500).json({
        status: err.response.status,
        data: err.response.data
      });
    }

    console.error(err.message);

    return res.status(500).json({
      error: err.message
    });
  }

});

/**
 * CHECK STATUS
 */
app.get("/status/:uuid", async (req, res) => {

  try {

    const authToken =
      await getValidToken();

    const response = await axios.get(
      `https://api.geminigen.ai/mobile/v1/history/${req.params.uuid}`,
      {
        headers: {
          authorization: authToken,
          "user-agent":
            "Dart/3.9 (dart:io)"
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
      data.generated_video?.[0]?.video_url ||
      null;

    return res.json({
      success: true,
      status,
      video_url: video,
      raw: data
    });

  } catch (err) {

    console.error("STATUS ERROR");

    if (err.response) {

      console.error(err.response.status);

      console.error(err.response.data);

      return res.status(500).json({
        status: err.response.status,
        data: err.response.data
      });
    }

    console.error(err.message);

    return res.status(500).json({
      error: err.message
    });
  }

});

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `RUNNING ON ${PORT}`
  );

});
