require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

console.log("SERVER STARTED");

/**
 * HEALTH
 */
app.get("/status/health", (req, res) => {

  res.json({
    ok: true
  });

});

/**
 * TOKEN TEST
 */
app.post("/generate", async (req, res) => {

  try {

    console.log("GENERATE HIT");

    const response = await axios.post(
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

    return res.json({
      success: true,
      api_response: response.data
    });

  } catch (e) {

    console.error("AXIOS ERROR");

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
