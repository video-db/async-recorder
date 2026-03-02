'use strict';

const { connect, AuthenticationError } = require('videodb');

/**
 * VideoDB service layer — wraps the Node SDK for server-side operations.
 * Maintains a connection cache keyed by API key.
 */
class VideoDBService {
  constructor(options = {}) {
    this._connections = new Map();
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
   * @param {string} [options.callbackUrl]
   * @param {object} [options.metadata]
   * @returns {Promise<{sessionId: string, collectionId: string, endUserId: string, status: string, callbackUrl: string}>}
   */
  async createCaptureSession(apiKey, { endUserId, callbackUrl, metadata }) {
    const conn = this._getConnection(apiKey);
    const session = await conn.createCaptureSession({
      endUserId,
      callbackUrl,
      metadata,
    });
    return {
      sessionId: session.id,
      collectionId: session.collectionId,
      endUserId: session.endUserId,
      status: session.status,
      callbackUrl: callbackUrl || null,
    };
  }

  /**
   * Clear a cached connection (e.g. on logout).
   */
  clearConnection(apiKey) {
    this._connections.delete(apiKey);
  }

  /**
   * Clear all cached connections.
   */
  clearAll() {
    this._connections.clear();
  }
}

module.exports = { VideoDBService };
