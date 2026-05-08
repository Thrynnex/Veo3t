require("dotenv").config();

const express = require("express");

const app = express();

app.use(express.json());

console.log("SERVER STARTED");

/**
 * HEALTH CHECK
 */
app.get("/status/health", (req, res) => {

  res.json({
    ok: true
  });

});

/**
 * TEST GENERATE
 */
app.post("/generate", async (req, res) => {

  try {

    console.log("GENERATE HIT");
    console.log(req.body);

    return res.json({
      working: true,
      received: req.body
    });

  } catch (e) {

    console.error("ERROR:");
    console.error(e);

    return res.status(500).json({
      error: e.message
    });
  }

});

/**
 * START SERVER
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`RUNNING ON ${PORT}`);

});
