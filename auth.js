const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TOKEN_FILE = path.join(__dirname, "tokens.json");

let tokenPromise = null;

function randomString(length) {

  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

  const bytes = crypto.randomBytes(length);

  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }

  return result;
}

function generateAndroidFcmToken() {

  const left = randomString(22);

  const right =
    "APA91b" + randomString(134);

  return `${left}:${right}`;
}

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

function decodeJWT(token) {

  try {

    const parts = token.split(".");

    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf8")
    );

    return payload;

  } catch {

    return null;
  }
}

function isExpired(token) {

  const payload = decodeJWT(token);

  if (!payload?.exp) return true;

  return Date.now() >= (payload.exp * 1000 - 60000);
}

function loadTokens() {

  try {

    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(
        fs.readFileSync(TOKEN_FILE, "utf8")
      );
    }

  } catch {}

  return null;
}

function saveTokens(data) {

  const temp = TOKEN_FILE + ".tmp";

  fs.writeFileSync(
    temp,
    JSON.stringify(data, null, 2)
  );

  fs.renameSync(temp, TOKEN_FILE);
}

function clearTokens() {

  try {

    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }

  } catch {}
}

async function refreshToken(refreshToken) {

  try {

    const r = await axios.post(
      "https://api.geminigen.ai/api/refresh-token",
      {
        refresh_token: refreshToken
      },
      {
        headers: {
          "content-type": "application/json",
          "user-agent": "Dart/3.8 (dart:io)"
        }
      }
    );

    return r.data;

  } catch {

    return null;
  }
}

async function createNewAccount() {

  const payload = {
    mobile_device_uuid: getDeviceID(),
    platform: "GenV-APP",
    device_token: generateAndroidFcmToken(),
    device_type: "android"
  };

  const r = await axios.post(
    "https://api.geminigen.ai/api/mobile/uuid/activate-account",
    payload,
    {
      headers: {
        "content-type": "application/json",
        "user-agent": "Dart/3.8 (dart:io)"
      }
    }
  );

  saveTokens(r.data);

  return r.data.access_token;
}

async function getToken() {

  const tokens = loadTokens();

  if (
    tokens?.access_token &&
    !isExpired(tokens.access_token)
  ) {
    return tokens.access_token;
  }

  if (
    tokens?.refresh_token
  ) {

    const refreshed =
      await refreshToken(tokens.refresh_token);

    if (refreshed?.access_token) {

      saveTokens(refreshed);

      return refreshed.access_token;
    }
  }

  if (tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = createNewAccount();

  try {

    return await tokenPromise;

  } finally {

    tokenPromise = null;
  }
}

module.exports = {
  getToken,
  clearTokens
};
