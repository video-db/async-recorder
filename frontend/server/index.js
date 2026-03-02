'use strict';

const express = require('express');
const cors = require('cors');
const {
  findRecordingBySessionId,
  findRecordingByVideoId,
  createRecording,
  updateRecording,
  getRecordings,
  getRecordingById,
  findUserByToken,
  findUserById,
  getLatestUser,
} = require('./database');
const { indexVideo } = require('./insights-service');

/**
 * Create the Express app for webhook reception and tunnel status.
 *
 * Only endpoints that need to be reachable over HTTP live here:
 *   - POST /api/webhook  (called by VideoDB servers)
 *   - GET  /api/tunnel/status
 *   - GET  /api/ (health check)
 *
 * All other operations (register, token, capture-session, recordings)
 * are handled directly via IPC in main.js — no HTTP needed.
 */
function createServer({ database, videodbService, tunnelManager }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/api/', (req, res) => {
    res.json({ status: 'ok', message: 'Async Recorder Server Running' });
  });

  // Tunnel status
  app.get('/api/tunnel/status', (req, res) => {
    res.json({
      active: tunnelManager.isRunning(),
      webhook_url: tunnelManager.getWebhookUrl(),
      provider: 'cloudflare',
    });
  });

  // Webhook handler — receives events from VideoDB
  app.post('/api/webhook', (req, res) => {
    try {
      const body = req.body;
      if (!body || !body.event) {
        return res.json({ status: 'ok', received: true });
      }

      const eventType = body.event || 'unknown';
      console.log(`[Webhook] Event: ${eventType}`);

      const data = body.data || {};
      const captureSessionId = body.capture_session_id;

      if (eventType === 'capture_session.exported') {
        const videoId = data.exported_video_id;
        const streamUrl = data.stream_url;
        const playerUrl = data.player_url;
        const sessionId = captureSessionId;

        if (videoId) {
          // Try to find existing recording by session_id
          let recording = findRecordingBySessionId(sessionId);

          if (recording) {
            updateRecording(recording.id, {
              video_id: videoId,
              stream_url: streamUrl,
              player_url: playerUrl,
              insights_status: 'pending',
            });
            console.log(`[Webhook] Updated recording: ${videoId}`);
          } else {
            // Check for duplicate by video_id
            const existing = findRecordingByVideoId(videoId);
            if (existing) {
              console.log(`[Webhook] Recording already exists: ${videoId}`);
              return res.json({ status: 'ok', received: true });
            }

            // Create new recording
            recording = createRecording({
              video_id: videoId,
              stream_url: streamUrl,
              player_url: playerUrl,
              session_id: sessionId,
              insights_status: 'pending',
            });
            console.log(`[Webhook] Created recording: ${videoId}`);
          }

          // Re-fetch to get the latest ID
          const rec = findRecordingByVideoId(videoId);

          // Schedule background indexing
          // Find the most recent user to get their API key
          const latestUser = getLatestUser();
          if (latestUser && latestUser.api_key && rec) {
            processIndexingBackground(rec.id, videoId, latestUser.api_key);
          }
        } else {
          console.warn('[Webhook] No video_id in exported event');
        }
      } else if (eventType.startsWith('capture_session.')) {
        console.log(`[Webhook] Capture session event: ${eventType}`);
      }

      res.json({ status: 'ok', received: true });
    } catch (err) {
      console.error('[Webhook] Error processing:', err);
      res.status(500).json({ error: 'Error processing webhook' });
    }
  });

  return app;
}

/**
 * Background indexing task — runs async, updates DB with results.
 * Mirrors Python's process_indexing_background().
 */
async function processIndexingBackground(recordingId, videoId, apiKey) {
  try {
    // Update status to processing
    updateRecording(recordingId, { insights_status: 'processing' });
    console.log(`[Index BG] Starting indexing for recording ${recordingId}`);

    const result = await indexVideo(videoId, apiKey);

    if (result) {
      const updates = { insights_status: 'ready' };

      if (result.transcript) {
        updates.insights = JSON.stringify({ transcript: result.transcript });
      }

      if (result.subtitleUrl) {
        updates.stream_url = result.subtitleUrl;

        // Update player_url by replacing the url= parameter
        const recording = getRecordingById(recordingId);
        if (recording && recording.player_url && recording.player_url.includes('url=')) {
          updates.player_url = recording.player_url.replace(/url=[^&]+/, `url=${result.subtitleUrl}`);
        } else {
          updates.player_url = result.subtitleUrl;
        }
      }

      updateRecording(recordingId, updates);
      console.log(`[Index BG] Indexed video ${videoId} successfully`);
    } else {
      updateRecording(recordingId, { insights_status: 'failed' });
      console.warn(`[Index BG] Failed to index video ${videoId}`);
    }
  } catch (err) {
    console.error(`[Index BG] Error processing:`, err);
    try {
      updateRecording(recordingId, { insights_status: 'failed' });
    } catch (e) {
      // Ignore DB errors during error handling
    }
  }
}

module.exports = { createServer };
