'use strict';

const { connect, AuthenticationError } = require('videodb');

/**
 * VideoDB service layer — wraps the Node SDK for server-side operations.
 * Maintains a connection cache keyed by API key.
 */
const BLOOM_COLLECTION_NAME = 'Bloom Recordings';

class VideoDBService {
  constructor(options = {}) {
    this._connections = new Map();
    this._collectionIds = new Map(); // apiKey → collectionId cache
    this._baseUrl = options.baseUrl || null; // optional override for dev
  }

  /**
   * Get or create a cached Connection for the given API key.
   */
  _getConnection(apiKey) {
    if (!apiKey) throw new Error('API key is required');
    if (this._connections.has(apiKey)) {
      return this._connections.get(apiKey);
    }
    const config = { apiKey };
    if (this._baseUrl) config.baseUrl = this._baseUrl;
    const conn = connect(config);
    this._connections.set(apiKey, conn);
    return conn;
  }

  /**
   * Get or create the "Bloom Recordings" collection. Caches the ID per API key.
   */
  async _getBloomCollection(apiKey) {
    const conn = this._getConnection(apiKey);

    // Return cached collection
    if (this._collectionIds.has(apiKey)) {
      return conn.getCollection(this._collectionIds.get(apiKey));
    }

    // Search existing collections
    const collections = await conn.getCollections();
    let bloomColl = collections.find((c) => c.name === BLOOM_COLLECTION_NAME);

    if (!bloomColl) {
      bloomColl = await conn.createCollection(
        BLOOM_COLLECTION_NAME,
        'Screen recordings captured with Bloom',
      );
    }

    this._collectionIds.set(apiKey, bloomColl.id);
    return bloomColl;
  }

  /**
   * Validate an API key by attempting to fetch the default collection.
   * @param {string} apiKey
   * @returns {Promise<boolean>}
   */
  async verifyApiKey(apiKey) {
    try {
      // Don't use cached connection — create fresh to truly verify
      const config = { apiKey };
      if (this._baseUrl) config.baseUrl = this._baseUrl;
      const conn = connect(config);
      await conn.getCollection();
      // Cache the verified connection
      this._connections.set(apiKey, conn);
      return true;
    } catch (err) {
      if (err instanceof AuthenticationError || err.name === 'AuthenticationError') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Generate a client session token for capture operations.
   * @param {string} apiKey - User's API key
   * @param {number} [expiresIn=86400] - Token lifetime in seconds
   * @returns {Promise<{sessionToken: string, expiresIn: number, expiresAt: number}>}
   */
  async generateSessionToken(apiKey, expiresIn = 86400) {
    const conn = this._getConnection(apiKey);
    const token = await conn.generateClientToken(expiresIn);
    return {
      sessionToken: token,
      expiresIn,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    };
  }

  /**
   * Create a capture session on VideoDB.
   * @param {string} apiKey
   * @param {object} options
   * @param {string} options.endUserId
   * @param {object} [options.metadata]
   * @returns {Promise<{sessionId: string, collectionId: string, endUserId: string, status: string}>}
   */
  async createCaptureSession(apiKey, { endUserId, metadata }) {
    const coll = await this._getBloomCollection(apiKey);
    const session = await coll.createCaptureSession({
      endUserId,
      metadata,
    });
    return {
      sessionId: session.id,
      collectionId: coll.id,
      endUserId: session.endUserId,
      status: session.status,
    };
  }

  /**
   * Fetch a capture session's current status from VideoDB.
   * Used as fallback when WebSocket misses events.
   * @param {string} apiKey
   * @param {string} sessionId - Capture session ID (cap-xxx)
   * @returns {Promise<{status: string, exportedVideoId: string|null}>}
   */
  async getCaptureSession(apiKey, sessionId) {
    const coll = await this._getBloomCollection(apiKey);
    const session = await coll.getCaptureSession(sessionId);
    return {
      status: session.status,
      exportedVideoId: session.exportedVideoId || null,
      streamUrl: session.streamUrl || null,
      playerUrl: session.playerUrl || null,
      collectionId: coll.id || null,
    };
  }

  /**
   * Fetch a fresh share URL for a video by calling the API.
   * @param {string} apiKey
   * @param {string} videoId
   * @returns {Promise<{streamUrl: string|null, playerUrl: string|null}>}
   */
  async getShareUrl(apiKey, videoId) {
    const coll = await this._getBloomCollection(apiKey);
    const video = await coll.getVideo(videoId);
    // generateStream returns the latest stream (with subtitles if indexed)
    // and updates video.playerUrl to match
    await video.generateStream();
    return {
      streamUrl: video.streamUrl || null,
      playerUrl: video.playerUrl || null,
    };
  }

  /**
   * Get a temporary download URL for a video.
   * @param {string} apiKey
   * @param {string} videoId
   * @returns {Promise<{url: string, name: string}>}
   */
  async getVideoDownloadUrl(apiKey, videoId) {
    const coll = await this._getBloomCollection(apiKey);
    const video = await coll.getVideo(videoId);
    const result = await video.download();
    return { url: result.url || result.downloadUrl, name: result.name || `${videoId}.mp4` };
  }

  /**
   * Get the full transcript text for a video.
   * @param {string} apiKey
   * @param {string} videoId
   * @returns {Promise<string>}
   */
  async getTranscriptText(apiKey, videoId) {
    const coll = await this._getBloomCollection(apiKey);
    const video = await coll.getVideo(videoId);
    return await video.getTranscriptText();
  }

  /**
   * Clear all cached connections (e.g. on logout).
   */
  clearAll() {
    this._connections.clear();
    this._collectionIds.clear();
  }
}

module.exports = { VideoDBService };
