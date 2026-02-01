/**
 * Response Translator for Streaming SSE Events
 *
 * Handles real-time translation of Claude API SSE responses (English -> Chinese).
 * Features:
 * - Sentence-level buffering for natural translation units
 * - Code block protection (preserves code unchanged)
 * - Tool use events pass-through (no translation needed)
 * - Graceful degradation on translation errors (falls back to original text)
 *
 * @module services/translation/ResponseTranslator
 */

const translationService = require('./translationService')
const codeBlockProtector = require('./codeBlockProtector')
const SentenceBuffer = require('./sentenceBuffer')
const logger = require('../../utils/logger')

class ResponseTranslator {
  /**
   * Create a new ResponseTranslator instance
   * @param {Object} account - Account configuration object
   * @param {boolean} account.enableTranslation - Whether translation is enabled for this account
   * @param {Object} outputStream - Output stream (Express response object)
   */
  constructor(account, outputStream) {
    // Check if translation is enabled for this account
    // Support both boolean true and string 'true' for flexibility
    this.enabled = account?.enableTranslation === true || account?.enableTranslation === 'true'

    this.outputStream = outputStream

    // Track current content block state
    this.currentBlockType = null // 'text' | 'tool_use' | null
    this.currentBlockIndex = null

    // Initialize sentence buffer for text blocks
    this.sentenceBuffer = new SentenceBuffer()

    // Statistics for logging
    this.stats = {
      totalEvents: 0,
      textDeltas: 0,
      sentencesTranslated: 0,
      translationErrors: 0,
      passedThrough: 0
    }

    if (this.enabled) {
      logger.debug('[ResponseTranslator] Initialized with translation enabled', {
        accountId: account?.id || account?.name || 'unknown'
      })
    }
  }

  /**
   * Process a single SSE event
   * @param {Object} event - Parsed SSE event object
   * @returns {Promise<void>}
   */
  async processEvent(event) {
    this.stats.totalEvents++

    // If translation not enabled, pass through all events unchanged
    if (!this.enabled) {
      this._passthrough(event)
      return
    }

    // Route event to appropriate handler based on type
    switch (event.type) {
      case 'content_block_start':
        this._handleBlockStart(event)
        break

      case 'content_block_delta':
        await this._handleDelta(event)
        break

      case 'content_block_stop':
        await this._handleBlockStop(event)
        break

      default:
        // Pass through message_start, message_delta, message_stop, ping, error, etc.
        this._passthrough(event)
    }
  }

  /**
   * Handle content_block_start event
   * Records the block type and index, resets sentence buffer
   * @private
   * @param {Object} event - content_block_start event
   */
  _handleBlockStart(event) {
    // Extract block type from the content_block object
    this.currentBlockType = event.content_block?.type || null
    this.currentBlockIndex = event.index

    // Reset sentence buffer for new text block
    this.sentenceBuffer.reset()

    logger.debug('[ResponseTranslator] Block started', {
      type: this.currentBlockType,
      index: this.currentBlockIndex
    })

    // Always pass through block start events unchanged
    this._passthrough(event)
  }

  /**
   * Handle content_block_delta event
   * For tool_use: pass through unchanged
   * For text: buffer text, detect sentences, translate complete sentences
   * @private
   * @param {Object} event - content_block_delta event
   */
  async _handleDelta(event) {
    // Tool use deltas (input_json_delta) pass through without translation
    if (this.currentBlockType === 'tool_use') {
      this._passthrough(event)
      return
    }

    // Handle text deltas
    if (this.currentBlockType === 'text' && event.delta?.text) {
      this.stats.textDeltas++
      const text = event.delta.text

      // Add text to sentence buffer
      const completeSentences = this.sentenceBuffer.add(text)

      // Translate and emit each complete sentence
      for (const sentence of completeSentences) {
        const translated = await this._translateSentence(sentence)
        this._emitTextDelta(translated)
      }
    } else {
      // Unknown delta type, pass through
      this._passthrough(event)
    }
  }

  /**
   * Handle content_block_stop event
   * Flushes remaining buffer content and translates it
   * @private
   * @param {Object} event - content_block_stop event
   */
  async _handleBlockStop(event) {
    // If this was a text block, translate any remaining buffered content
    if (this.currentBlockType === 'text') {
      const remaining = this.sentenceBuffer.flush()

      if (remaining && remaining.trim()) {
        const translated = await this._translateSentence(remaining)
        this._emitTextDelta(translated)
      }
    }

    // Reset block tracking state
    this.currentBlockType = null
    this.currentBlockIndex = null

    // Log stats for this block
    logger.debug('[ResponseTranslator] Block completed', {
      index: event.index,
      textDeltas: this.stats.textDeltas,
      sentencesTranslated: this.stats.sentencesTranslated,
      translationErrors: this.stats.translationErrors
    })

    // Pass through the block stop event
    this._passthrough(event)
  }

  /**
   * Translate a sentence with code block protection
   * Falls back to original text on translation failure
   * @private
   * @param {string} sentence - Sentence to translate
   * @returns {Promise<string>} Translated sentence (or original on error)
   */
  async _translateSentence(sentence) {
    if (!sentence) {
      return sentence
    }

    // Extract and protect code blocks
    const { cleanText, placeholders } = codeBlockProtector.extract(sentence)

    // If the sentence is all code (no text to translate), return as-is
    if (!cleanText.trim()) {
      return sentence
    }

    try {
      // Translate from English to Chinese
      const translated = await translationService.translate(cleanText, 'en', 'zh')

      // Restore protected code blocks
      const result = codeBlockProtector.restore(translated, placeholders)

      this.stats.sentencesTranslated++
      return result
    } catch (error) {
      // Log translation error and fall back to original text
      this.stats.translationErrors++
      logger.error('[ResponseTranslator] Translation failed, using original text', {
        error: error.message,
        sentenceLength: sentence.length,
        sentencePreview: sentence.slice(0, 50) + (sentence.length > 50 ? '...' : '')
      })

      // Return original sentence on error (graceful degradation)
      return sentence
    }
  }

  /**
   * Emit a text delta event with translated text
   * @private
   * @param {string} text - Translated text to emit
   */
  _emitTextDelta(text) {
    if (!text) {
      return
    }

    const event = {
      type: 'content_block_delta',
      index: this.currentBlockIndex,
      delta: {
        type: 'text_delta',
        text: text
      }
    }

    this._writeSSE(event)
  }

  /**
   * Pass through an event unchanged
   * @private
   * @param {Object} event - Event to pass through
   */
  _passthrough(event) {
    this.stats.passedThrough++
    this._writeSSE(event)
  }

  /**
   * Write an event to the output stream in SSE format
   * @private
   * @param {Object} event - Event object to write
   */
  _writeSSE(event) {
    // Check if stream is still writable
    if (this.outputStream && this.outputStream.writable) {
      try {
        this.outputStream.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch (error) {
        logger.error('[ResponseTranslator] Failed to write to output stream', {
          error: error.message
        })
      }
    }
  }

  /**
   * Get translation statistics
   * @returns {Object} Statistics about processed events
   */
  getStats() {
    return {
      ...this.stats,
      enabled: this.enabled,
      bufferLength: this.sentenceBuffer.length
    }
  }

  /**
   * Check if translation is enabled for this instance
   * @returns {boolean} Whether translation is enabled
   */
  isEnabled() {
    return this.enabled
  }

  /**
   * Finalize the translator and log summary stats
   * Call this when the response stream ends
   */
  finalize() {
    // Flush any remaining buffer content (should be empty normally)
    const remaining = this.sentenceBuffer.flush()
    if (remaining) {
      logger.warn('[ResponseTranslator] Finalize called with non-empty buffer', {
        remaining: remaining.slice(0, 50) + (remaining.length > 50 ? '...' : ''),
        length: remaining.length
      })
    }

    // Log summary statistics
    if (this.enabled) {
      logger.info('[ResponseTranslator] Response translation completed', {
        totalEvents: this.stats.totalEvents,
        textDeltas: this.stats.textDeltas,
        sentencesTranslated: this.stats.sentencesTranslated,
        translationErrors: this.stats.translationErrors,
        passedThrough: this.stats.passedThrough
      })
    }
  }
}

module.exports = ResponseTranslator
