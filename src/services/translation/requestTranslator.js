/**
 * Request Translator Module
 * Translates user messages in requests from Chinese to English
 *
 * @module services/translation/requestTranslator
 */

const translationService = require('./translationService')
const codeBlockProtector = require('./codeBlockProtector')
const languageDetector = require('./languageDetector')
const logger = require('../../utils/logger')

class RequestTranslator {
  /**
   * Translate user messages in the request body
   *
   * @param {Object} requestBody - Original request body
   * @param {Object} account - Account configuration
   * @param {boolean} account.enableTranslation - Whether translation is enabled
   * @returns {Promise<Object>} Translated request body (deep copy, original not modified)
   */
  async translateRequest(requestBody, account) {
    // If translation is not enabled, return original request body
    if (!account?.enableTranslation) {
      return requestBody
    }

    // Validate request body has messages
    if (!requestBody?.messages || !Array.isArray(requestBody.messages)) {
      logger.debug('[RequestTranslator] No messages array found, skipping translation')
      return requestBody
    }

    const startTime = Date.now()

    try {
      // Deep copy to avoid modifying the original object
      const translatedBody = JSON.parse(JSON.stringify(requestBody))

      let translatedCount = 0
      let skippedCount = 0

      // Translate only user messages
      for (const message of translatedBody.messages) {
        if (message.role === 'user') {
          const originalContent = message.content
          message.content = await this._translateContent(message.content)

          // Check if content was actually translated
          if (message.content !== originalContent) {
            translatedCount++
          } else {
            skippedCount++
          }
        }
      }

      const duration = Date.now() - startTime

      logger.info('[RequestTranslator] Request translated', {
        accountId: account.id,
        messageCount: translatedBody.messages.length,
        translatedCount,
        skippedCount,
        sourceLang: 'zh',
        targetLang: 'en',
        duration
      })

      return translatedBody
    } catch (error) {
      const duration = Date.now() - startTime

      logger.error('[RequestTranslator] Translation failed, returning original request', {
        accountId: account?.id,
        error: error.message,
        duration
      })

      // On error, return original request body to ensure request can still proceed
      return requestBody
    }
  }

  /**
   * Translate message content
   * Content can be a string or an array of content blocks
   *
   * @param {string|Array} content - Message content
   * @returns {Promise<string|Array>} Translated content
   * @private
   */
  async _translateContent(content) {
    // Handle string content
    if (typeof content === 'string') {
      return await this._translateText(content)
    }

    // Handle array content (multimodal messages)
    if (Array.isArray(content)) {
      // Create a new array to avoid modifying during iteration
      const translatedBlocks = []

      for (const block of content) {
        if (block.type === 'text' && block.text) {
          // Only translate text blocks
          const translatedBlock = { ...block }
          translatedBlock.text = await this._translateText(block.text)
          translatedBlocks.push(translatedBlock)
        } else {
          // Other types (image, tool_result, etc.) are not processed
          translatedBlocks.push(block)
        }
      }

      return translatedBlocks
    }

    // Unknown content type, return as-is
    logger.warn('[RequestTranslator] Unknown content type, skipping translation', {
      contentType: typeof content
    })
    return content
  }

  /**
   * Translate a single text string
   *
   * @param {string} text - Text to translate
   * @returns {Promise<string>} Translated text
   * @private
   */
  async _translateText(text) {
    // Handle empty or whitespace-only text
    if (!text || !text.trim()) {
      return text
    }

    try {
      // 1. Check if text contains Chinese
      if (!languageDetector.containsChinese(text)) {
        logger.debug('[RequestTranslator] No Chinese detected, skipping translation', {
          textLength: text.length
        })
        return text
      }

      // 2. Protect code blocks by replacing them with placeholders
      const { cleanText, placeholders } = codeBlockProtector.extract(text)

      // 3. If no translatable content remains after extraction, return original
      if (!cleanText.trim()) {
        logger.debug('[RequestTranslator] Only code blocks found, skipping translation')
        return text
      }

      // 4. Translate the clean text (Chinese -> English)
      const translatedText = await translationService.translate(cleanText, 'zh', 'en')

      // 5. Restore code blocks in the translated text
      const restoredText = codeBlockProtector.restore(translatedText, placeholders)

      logger.debug('[RequestTranslator] Text translated successfully', {
        originalLength: text.length,
        translatedLength: restoredText.length,
        codeBlocksCount: Object.keys(placeholders).length
      })

      return restoredText
    } catch (error) {
      logger.error('[RequestTranslator] Text translation failed, using original', {
        error: error.message,
        textPreview: text.slice(0, 100)
      })

      // On translation failure, return original text (graceful degradation)
      return text
    }
  }
}

module.exports = new RequestTranslator()
