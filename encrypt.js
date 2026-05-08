const crypto = require("crypto");

function pad(n) {
  return n.toString().padStart(2, "0");
}

module.exports = function encodeToken(token) {

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
    process.env.AES_KEY,
    "utf8"
  );

  const iv = Buffer.from(
    process.env.AES_IV,
    "utf8"
  );

  if (key.length !== 32) {
    throw new Error(
      "AES_KEY must be exactly 32 bytes"
    );
  }

  if (iv.length !== 16) {
    throw new Error(
      "AES_IV must be exactly 16 bytes"
    );
  }

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    key,
    iv
  );

  let encrypted =
    cipher.update(raw, "utf8", "base64");

  encrypted += cipher.final("base64");

  return encrypted;
};
