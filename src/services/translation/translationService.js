/**
 * Translation Service
 *
 * Provides bidirectional Chinese-English translation using OpenAI-compatible API.
 * Uses existing openai-responses account system for API access (e.g., qwen/dashscope).
 * Features:
 * - LRU caching with SHA256 keys for efficient repeated translations
 * - Code block and inline code protection via placeholders
 * - Configurable cache size and translation model
 * - Uses existing account management for API credentials
 * - Detailed logging for monitoring and debugging
 */

const crypto = require('crypto')
const https = require('https')
const http = require('http')
const LRUCache = require('../../utils/lruCache')
const config = require('../../../config/config')
const logger = require('../../utils/logger')

class TranslationService {
  constructor() {
    // Initialize cache with configurable size (default 1000)
    const cacheSize = config.translation?.cacheSize || 1000
    this.cache = new LRUCache(cacheSize)

    // Default to qwen3-8b model for cost-effective translation
    this.model = config.translation?.model || 'qwen3-8b'

    // Cache TTL in milliseconds (default 24 hours)
    this.cacheTTLMs = (config.translation?.cacheTTLHours || 24) * 60 * 60 * 1000

    // Language display names for prompt generation
    this.languageNames = {
      zh: 'Chinese',
      en: 'English'
    }

    logger.info('[TranslationService] Initialized', {
      cacheSize,
      model: this.model,
      accountId: config.translation?.accountId || 'not configured',
      cacheTTLHours: config.translation?.cacheTTLHours || 24
    })
  }

  /**
   * Translate text from source language to target language
   * @param {string} text - Text to translate
   * @param {string} sourceLang - Source language code (zh/en)
   * @param {string} targetLang - Target language code (zh/en)
   * @returns {Promise<string>} Translated text
   * @throws {Error} If translation fails
   */
  async translate(text, sourceLang, targetLang) {
    // Return early for empty or whitespace-only text
    if (!text?.trim()) {
      return text
    }

    // Validate language codes
    if (!this.languageNames[sourceLang] || !this.languageNames[targetLang]) {
      throw new Error(`Unsupported language pair: ${sourceLang} -> ${targetLang}`)
    }

    // Skip translation if source and target are the same
    if (sourceLang === targetLang) {
      return text
    }

    const startTime = Date.now()

    // Generate cache key using SHA256 hash
    const cacheKey = this._getCacheKey(text, sourceLang, targetLang)

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      logger.debug('[TranslationService] Cache hit', {
        cacheKey: cacheKey.slice(0, 20) + '...',
        sourceLang,
        targetLang,
        textLength: text.length
      })
      return cached
    }

    logger.debug('[TranslationService] Cache miss, calling API', {
      cacheKey: cacheKey.slice(0, 20) + '...',
      sourceLang,
      targetLang,
      textLength: text.length
    })

    // Call translation API
    const translated = await this._callTranslationAPI(text, sourceLang, targetLang)

    // Store in cache with TTL
    this.cache.set(cacheKey, translated, this.cacheTTLMs)

    const duration = Date.now() - startTime
    logger.info('[TranslationService] Translation completed', {
      sourceLang,
      targetLang,
      inputLength: text.length,
      outputLength: translated.length,
      duration,
      cacheHit: false
    })

    return translated
  }

  /**
   * Call the translation API (OpenAI-compatible format)
   * @private
   * @param {string} text - Text to translate
   * @param {string} sourceLang - Source language code
   * @param {string} targetLang - Target language code
   * @returns {Promise<string>} Translated text
   */
  async _callTranslationAPI(text, sourceLang, targetLang) {
    const sourceLangName = this.languageNames[sourceLang]
    const targetLangName = this.languageNames[targetLang]

    // System prompt for translation
    const systemPrompt = `You are a professional translator. Translate text accurately and naturally.

Rules:
1. Return ONLY the translated text, no explanations or notes
2. Preserve all formatting, line breaks, and whitespace
3. Preserve placeholders like __CODE_BLOCK_0__ and __INLINE_CODE_0__ exactly as-is
4. Maintain the original tone and style
5. For technical terms, prefer commonly used translations`

    // User prompt with the text to translate
    const userPrompt = `Translate the following from ${sourceLangName} to ${targetLangName}:

${text}`

    // Make the API request using existing account system
    const response = await this._makeOpenAICompatibleRequest(systemPrompt, userPrompt)

    return response.trim()
  }

  /**
   * Make a request to OpenAI-compatible API using existing account system
   * @private
   * @param {string} systemPrompt - System prompt
   * @param {string} userPrompt - User prompt
   * @returns {Promise<string>} Response text
   */
  async _makeOpenAICompatibleRequest(systemPrompt, userPrompt) {
    // Lazy load to avoid circular dependency
    const openaiResponsesAccountService = require('../openaiResponsesAccountService')

    // Get translation account ID from config
    const accountId = config.translation?.accountId
    if (!accountId) {
      throw new Error(
        'Translation account not configured. Set TRANSLATION_ACCOUNT_ID to an openai-responses account ID.'
      )
    }

    // Get account from openai-responses service
    const account = await openaiResponsesAccountService.getAccount(accountId)
    if (!account) {
      throw new Error(`Translation account not found: ${accountId}`)
    }

    if (!account.apiKey) {
      throw new Error(`Translation account ${accountId} has no API key configured`)
    }

    if (!account.baseApi) {
      throw new Error(`Translation account ${accountId} has no base API URL configured`)
    }

    // Parse base API URL
    let apiProtocol, apiHostname, apiPort, apiBasePath
    try {
      const url = new URL(account.baseApi)
      apiProtocol = url.protocol === 'https:' ? 'https' : 'http'
      apiHostname = url.hostname
      apiPort = url.port || (apiProtocol === 'https' ? 443 : 80)
      apiBasePath = url.pathname.replace(/\/$/, '') // Remove trailing slash
    } catch (error) {
      throw new Error(`Invalid base API URL in account ${accountId}: ${account.baseApi}`)
    }

    // Build request body in OpenAI chat completions format
    const requestBody = {
      model: this.model,
      max_tokens: config.translation?.maxTokens || 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }

    // qwen3 models require enable_thinking: false for non-streaming calls
    if (this.model.startsWith('qwen3')) {
      requestBody.enable_thinking = false
    }

    const requestData = JSON.stringify(requestBody)

    // Send request
    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: apiHostname,
        port: apiPort,
        path: `${apiBasePath}/chat/completions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestData),
          Authorization: `Bearer ${account.apiKey}`
        },
        timeout: 60000 // 60 seconds timeout
      }

      // Add custom user agent if configured
      if (account.userAgent) {
        requestOptions.headers['User-Agent'] = account.userAgent
      }

      const httpModule = apiProtocol === 'https' ? https : http

      logger.debug('[TranslationService] Making request to:', {
        hostname: apiHostname,
        path: requestOptions.path,
        model: this.model
      })

      const req = httpModule.request(requestOptions, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          try {
            const response = JSON.parse(data)

            if (res.statusCode !== 200) {
              const errorMessage =
                response.error?.message || `HTTP ${res.statusCode}: ${data.slice(0, 200)}`
              logger.error('[TranslationService] API error:', {
                statusCode: res.statusCode,
                error: response.error,
                hostname: apiHostname
              })
              reject(new Error(`Translation API error: ${errorMessage}`))
              return
            }

            // Extract response text from OpenAI format
            const choices = response.choices
            if (!choices || !Array.isArray(choices) || choices.length === 0) {
              reject(new Error('Translation API returned empty choices'))
              return
            }

            const message = choices[0].message
            if (!message || !message.content) {
              reject(new Error('Translation API returned no message content'))
              return
            }

            resolve(message.content)
          } catch (parseError) {
            logger.error('[TranslationService] Failed to parse response:', {
              error: parseError.message,
              data: data.slice(0, 500)
            })
            reject(new Error(`Failed to parse translation response: ${parseError.message}`))
          }
        })
      })

      req.on('error', (error) => {
        logger.error('[TranslationService] Request failed:', {
          error: error.message,
          hostname: apiHostname
        })
        reject(new Error(`Translation request failed: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Translation request timed out'))
      })

      req.write(requestData)
      req.end()
    })
  }

  /**
   * Generate cache key using SHA256 hash
   * @private
   * @param {string} text - Text to hash
   * @param {string} sourceLang - Source language
   * @param {string} targetLang - Target language
   * @returns {string} Cache key in format trans:{hash}
   */
  _getCacheKey(text, sourceLang, targetLang) {
    const hash = crypto
      .createHash('sha256')
      .update(`${sourceLang}:${targetLang}:${text}`)
      .digest('hex')
      .slice(0, 16)
    return `trans:${hash}`
  }

  /**
   * Clear the translation cache
   */
  clearCache() {
    const statsBefore = this.cache.getStats()
    this.cache.clear()
    logger.info('[TranslationService] Cache cleared', {
      itemsCleared: statsBefore.size
    })
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics including size, hits, misses, hit rate
   */
  getCacheStats() {
    const stats = this.cache.getStats()
    return {
      size: stats.size,
      maxSize: stats.maxSize,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: stats.hitRate,
      evictions: stats.evictions,
      total: stats.total
    }
  }

  /**
   * Check if translation is enabled globally
   * @returns {boolean} Whether translation feature is enabled
   */
  isEnabled() {
    return config.translation?.enabled === true
  }

  /**
   * Get the translation model being used
   * @returns {string} Model identifier
   */
  getModel() {
    return this.model
  }

  /**
   * Update the translation model at runtime
   * @param {string} model - New model identifier
   */
  setModel(model) {
    const oldModel = this.model
    this.model = model
    logger.info('[TranslationService] Model updated', {
      oldModel,
      newModel: model
    })
  }
}

// Export singleton instance
module.exports = new TranslationService()
