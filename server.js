require("dotenv").config();

const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");

const app = express();
app.use(express.json());

/**
 * ─── TOKEN STORE ────────────────────────────────────────────────────────────
 * We keep ONE token in memory. The key insight: every task must be polled
 * with the SAME account (token) that submitted it. So we pin each queued
 * job to the token that was active at submission time and refresh only
 * when that specific token gets a TOKEN_EXPIRED error.
 */
let savedToken = null;

function getDeviceID() {
  const chars = "0123456789abcdef";
  let uuid = "";
  for (let i = 0; i < 16; i++) uuid += chars[Math.floor(Math.random() * chars.length)];
  return uuid;
}

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function randomString(length) {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) result += CHARS[bytes[i] % CHARS.length];
  return result;
}

function generateAndroidFcmToken() {
  return `${randomString(22)}:APA91b${randomString(134)}`;
}

async function fetchNewToken() {
  const res = await axios.post(
    "https://api.geminigen.ai/api/mobile/uuid/activate-account",
    {
      mobile_device_uuid: getDeviceID(),
      platform: "GenV-APP",
      device_token: generateAndroidFcmToken(),
      device_type: "android"
    },
    {
      headers: {
        "user-agent": "Dart/3.9 (dart:io)",
        "content-type": "application/json"
      }
    }
  );
  return `Bearer ${res.data.access_token}`;
}

async function getValidToken(forceNew = false) {
  if (savedToken && !forceNew) return savedToken;
  savedToken = await fetchNewToken();
  return savedToken;
}

/**
 * Helper: run an API call; if TOKEN_EXPIRED, refresh global token and retry.
 * Returns { data, usedToken } so the caller knows which token actually worked.
 */
async function withTokenRetry(fn) {
  let token = await getValidToken();
  try {
    const data = await fn(token);
    return { data, token };
  } catch (e) {
    if (
      e.response?.status === 403 &&
      e.response?.data?.detail?.error_code === "TOKEN_EXPIRED"
    ) {
      console.log("TOKEN_EXPIRED → refreshing");
      token = await getValidToken(true);
      const data = await fn(token);
      return { data, token };
    }
    throw e;
  }
}

/**
 * ─── JOB QUEUE ──────────────────────────────────────────────────────────────
 *
 * jobs: Map<uuid, JobRecord>
 *
 * JobRecord {
 *   uuid        string
 *   token       string   ← token used to submit; we poll with this same one
 *   status      'queued' | 'processing' | 'done' | 'failed'
 *   video_url   string | null
 *   raw         object | null
 *   error       string | null
 *   createdAt   number
 *   updatedAt   number
 * }
 *
 * Why store the token per-job?
 * geminigen.ai ties video history to the account that submitted it.
 * If the global token rotates (new device), the old UUID becomes
 * invisible under the new account. Pinning the token to the job
 * means we always query the right account.
 */
const jobs = new Map();

const POLL_INTERVAL_MS  = 8_000;   // how often to poll each pending job
const POLL_MAX_ATTEMPTS = 90;      // 90 × 8 s = 12 min max wait
const JOB_TTL_MS        = 2 * 60 * 60 * 1000; // keep records 2 h after completion

/**
 * Poll a single job until it completes or exhausts attempts.
 */
async function pollJob(uuid) {
  const job = jobs.get(uuid);
  if (!job) return;

  let attempts = 0;

  const tick = async () => {
    const job = jobs.get(uuid);
    if (!job || job.status === "done" || job.status === "failed") return;

    if (attempts >= POLL_MAX_ATTEMPTS) {
      job.status   = "failed";
      job.error    = "Timed out waiting for generation";
      job.updatedAt = Date.now();
      console.log(`[queue] ${uuid} timed out`);
      return;
    }

    attempts++;

    try {
      // Always poll with the token that submitted this job.
      // If that token is expired, refresh globally and update the job's token.
      let pollToken = job.token;

      let response;
      try {
        response = await axios.get(
          `https://api.geminigen.ai/mobile/v1/history/${uuid}`,
          {
            headers: {
              authorization: pollToken,
              "user-agent": "Dart/3.9 (dart:io)"
            }
          }
        );
      } catch (e) {
        if (
          e.response?.status === 403 &&
          e.response?.data?.detail?.error_code === "TOKEN_EXPIRED"
        ) {
          // The account token expired → get a fresh one and save it on the job
          pollToken = await getValidToken(true);
          job.token = pollToken;

          response = await axios.get(
            `https://api.geminigen.ai/mobile/v1/history/${uuid}`,
            {
              headers: {
                authorization: pollToken,
                "user-agent": "Dart/3.9 (dart:io)"
              }
            }
          );
        } else if (
          e.response?.status === 404 ||
          (e.response?.status === 500 &&
            JSON.stringify(e.response?.data || "").includes("not found"))
        ) {
          // The record doesn't exist yet on the server — just keep waiting
          console.log(`[queue] ${uuid} not found yet (attempt ${attempts}), retrying…`);
          job.updatedAt = Date.now();
          setTimeout(tick, POLL_INTERVAL_MS);
          return;
        } else {
          throw e;
        }
      }

      const data = response.data;
      job.raw       = data;
      job.updatedAt = Date.now();

      if (data.status === 2) {
        job.status    = "done";
        job.video_url = data.generated_video?.[0]?.video_url || null;
        console.log(`[queue] ${uuid} done → ${job.video_url}`);
        // Schedule cleanup
        setTimeout(() => jobs.delete(uuid), JOB_TTL_MS);
        return;
      }

      if (data.status === 3) {
        job.status = "failed";
        job.error  = "Generation failed on upstream server";
        console.log(`[queue] ${uuid} failed`);
        setTimeout(() => jobs.delete(uuid), JOB_TTL_MS);
        return;
      }

      // Still processing
      job.status = "processing";
      console.log(`[queue] ${uuid} still processing (attempt ${attempts})`);
      setTimeout(tick, POLL_INTERVAL_MS);

    } catch (err) {
      console.error(`[queue] ${uuid} poll error:`, err.response?.data || err.message);
      // Don't kill the job on a transient error, just retry
      setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  // First poll after a short delay (give the upstream a moment to register the job)
  setTimeout(tick, 3_000);
}

/**
 * ─── ROUTES ─────────────────────────────────────────────────────────────────
 */

app.get("/status/health", (req, res) => res.json({ ok: true, queued: jobs.size }));

/**
 * POST /generate
 * Submits a generation job and immediately returns a task_id.
 * The actual generation is tracked in the background queue.
 */
app.post("/generate", async (req, res) => {
  try {
    const prompt = req.body.prompt || "a dog and a guy";
    const ratio  = req.body.ratio  || "16:9";

    const form = new FormData();
    form.append("prompt",       prompt);
    form.append("model",        "veo-3.1-lite");
    form.append("duration",     "8");
    form.append("resolution",   "720p");
    form.append("aspect_ratio", ratio);
    form.append("service_mode", "stable");

    const { data: genData, token: usedToken } = await withTokenRetry((token) =>
      axios.post(
        "https://api.geminigen.ai/mobile/v3/video-gen",
        form,
        {
          headers: {
            ...form.getHeaders(),
            authorization: token,
            "user-agent": "Dart/3.9 (dart:io)"
          }
        }
      ).then((r) => r.data)
    );

    const uuid = genData.uuid;

    // Register in the queue, pinning the token used for this submission
    jobs.set(uuid, {
      uuid,
      token:     usedToken,
      status:    "queued",
      video_url: null,
      raw:       null,
      error:     null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // Start background polling
    pollJob(uuid);

    console.log(`[queue] ${uuid} queued with token ${usedToken.slice(0, 20)}…`);

    return res.json({
      success:  true,
      task_id:  uuid,
      task_url: `${req.protocol}://${req.get("host")}/status/${uuid}`
    });

  } catch (err) {
    console.error("GENERATE ERROR", err.response?.data || err.message);
    if (err.response) {
      return res.status(500).json({ status: err.response.status, data: err.response.data });
    }
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /status/:uuid
 * Returns the current state of a queued job.
 * Never hits the upstream API directly — reads from the in-memory queue.
 */
app.get("/status/:uuid", (req, res) => {
  const job = jobs.get(req.params.uuid);

  if (!job) {
    return res.status(404).json({
      success: false,
      error:   "Job not found. It may have expired or never been submitted through this server."
    });
  }

  return res.json({
    success:   true,
    status:    job.status,          // queued | processing | done | failed
    video_url: job.video_url,
    error:     job.error,
    age_s:     Math.round((Date.now() - job.createdAt) / 1000),
    raw:       job.raw
  });
});

/**
 * GET /queue
 * Debug endpoint — lists all tracked jobs.
 */
app.get("/queue", (req, res) => {
  const list = [...jobs.values()].map(({ uuid, status, video_url, error, createdAt, updatedAt }) => ({
    uuid, status, video_url, error,
    age_s:     Math.round((Date.now() - createdAt) / 1000),
    updated_s: Math.round((Date.now() - updatedAt) / 1000)
  }));
  res.json({ count: list.length, jobs: list });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RUNNING ON ${PORT}`));
