require("dotenv").config();

const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");

const app = express();

app.use(express.json());

/**
 * MEMORY TOKEN
 */
let savedToken = null;

/**
 * RANDOM DEVICE ID
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
 * GET TOKEN
 */
async function getValidToken(forceNew = false) {

  if (savedToken && !forceNew) {
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
        "user-agent":
          "Dart/3.9 (dart:io)",

        "content-type":
          "application/json"
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

    let authToken =
      await getValidToken();

    /**
     * FORM
     */
    const form = new FormData();

    form.append(
      "prompt",
      prompt
    );

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
    let genRes;

    try {

      genRes = await axios.post(
        "https://api.geminigen.ai/mobile/v3/video-gen",
        form,
        {
          headers: {
            ...form.getHeaders(),

            authorization:
              authToken,

            "user-agent":
              "Dart/3.9 (dart:io)"
          }
        }
      );

    } catch (e) {

      /**
       * TOKEN EXPIRED
       */
      if (
        e.response?.status === 403 &&
        e.response?.data?.detail?.error_code ===
          "TOKEN_EXPIRED"
      ) {

        console.log(
          "TOKEN EXPIRED -> REFRESHING"
        );

        authToken =
          await getValidToken(true);

        genRes = await axios.post(
          "https://api.geminigen.ai/mobile/v3/video-gen",
          form,
          {
            headers: {
              ...form.getHeaders(),

              authorization:
                authToken,

              "user-agent":
                "Dart/3.9 (dart:io)"
            }
          }
        );

      } else {

        throw e;
      }
    }

    /**
     * SUCCESS
     */
    return res.json({
      success: true,

      task_id:
        genRes.data.uuid,

      task_url:
        `${req.protocol}://${req.get("host")}/status/${genRes.data.uuid}`
    });

  } catch (err) {

    console.error(
      "GENERATE ERROR"
    );

    if (err.response) {

      console.error(
        err.response.status
      );

      console.error(
        err.response.data
      );

      return res.status(500).json({
        status:
          err.response.status,

        data:
          err.response.data
      });
    }

    console.error(err.message);

    return res.status(500).json({
      error:
        err.message
    });
  }

});

/**
 * STATUS CHECK
 */
app.get("/status/:uuid", async (req, res) => {

  try {

    let authToken =
      await getValidToken();

    let response;

    try {

      response = await axios.get(
        `https://api.geminigen.ai/mobile/v1/history/${req.params.uuid}`,
        {
          headers: {
            authorization:
              authToken,

            "user-agent":
              "Dart/3.9 (dart:io)"
          }
        }
      );

    } catch (e) {

      /**
       * TOKEN EXPIRED
       */
      if (
        e.response?.status === 403 &&
        e.response?.data?.detail?.error_code ===
          "TOKEN_EXPIRED"
      ) {

        authToken =
          await getValidToken(true);

        response = await axios.get(
          `https://api.geminigen.ai/mobile/v1/history/${req.params.uuid}`,
          {
            headers: {
              authorization:
                authToken,

              "user-agent":
                "Dart/3.9 (dart:io)"
            }
          }
        );

      } else {

        throw e;
      }
    }

    const data =
      response.data;

    let status =
      "started";

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

    console.error(
      "STATUS ERROR"
    );

    if (err.response) {

      console.error(
        err.response.status
      );

      console.error(
        err.response.data
      );

      return res.status(500).json({
        status:
          err.response.status,

        data:
          err.response.data
      });
    }

    console.error(err.message);

    return res.status(500).json({
      error:
        err.message
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
