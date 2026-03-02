'use strict';

const { spawn } = require('child_process');
const path = require('path');

/**
 * Cloudflare Quick Tunnel Manager for Node.js.
 * Replicates Python pycloudflared behavior: spawns cloudflared binary,
 * parses the public tunnel URL from stderr output.
 */
class TunnelManager {
  constructor() {
    this._process = null;
    this._publicUrl = null;
    this._webhookUrl = null;
  }

  /**
   * Start a Cloudflare quick tunnel.
   * @param {number} port - Local port to tunnel
   * @param {string} [existingWebhookUrl] - If set via env, skip tunnel startup
   * @returns {Promise<string|null>} The webhook URL, or null on failure
   */
  start(port, existingWebhookUrl) {
    if (existingWebhookUrl) {
      this._webhookUrl = existingWebhookUrl;
      console.log(`[Tunnel] Using configured webhook URL: ${existingWebhookUrl}`);
      return Promise.resolve(existingWebhookUrl);
    }

    return new Promise((resolve) => {
      try {
        // Spawn cloudflared with quick tunnel (no auth needed)
        const args = ['tunnel', '--url', `http://localhost:${port}`];
        console.log(`[Tunnel] Starting cloudflared ${args.join(' ')}`);

        this._process = spawn('cloudflared', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.error('[Tunnel] Timeout waiting for tunnel URL');
            resolve(null);
          }
        }, 30000);

        const handleOutput = (data) => {
          const output = data.toString();
          // cloudflared prints the tunnel URL to stderr
          // Look for the trycloudflare.com URL pattern
          const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            this._publicUrl = match[0];
            this._webhookUrl = `${this._publicUrl}/api/webhook`;
            console.log(`[Tunnel] Cloudflare tunnel active: ${this._publicUrl} -> localhost:${port}`);
            console.log(`[Tunnel] Webhook URL: ${this._webhookUrl}`);
            resolve(this._webhookUrl);
          }
        };

        this._process.stdout.on('data', handleOutput);
        this._process.stderr.on('data', handleOutput);

        this._process.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            if (err.code === 'ENOENT') {
              console.error('[Tunnel] cloudflared binary not found. Install with: brew install cloudflared');
            } else {
              console.error('[Tunnel] Failed to start tunnel:', err.message);
            }
            resolve(null);
          }
        });

        this._process.on('exit', (code) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.error(`[Tunnel] cloudflared exited with code ${code}`);
            resolve(null);
          }
          this._process = null;
          this._publicUrl = null;
        });
      } catch (err) {
        console.error('[Tunnel] Error starting tunnel:', err.message);
        resolve(null);
      }
    });
  }

  /**
   * Stop the tunnel process.
   */
  stop() {
    if (this._process) {
      try {
        this._process.kill('SIGTERM');
      } catch (err) {
        console.error('[Tunnel] Error stopping tunnel:', err.message);
      }
      this._process = null;
    }
    this._publicUrl = null;
    this._webhookUrl = null;
  }

  /**
   * Check if the tunnel is running.
   */
  isRunning() {
    return this._process !== null && this._publicUrl !== null;
  }

  /**
   * Get the public tunnel URL (without path).
   */
  getUrl() {
    return this._publicUrl;
  }

  /**
   * Get the full webhook URL.
   */
  getWebhookUrl() {
    return this._webhookUrl;
  }
}

module.exports = { TunnelManager };
