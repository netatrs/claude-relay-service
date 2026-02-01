/**
 * Sentence Buffer for Streaming Translation
 *
 * Buffers streaming text and detects sentence boundaries for translation.
 * Supports Chinese and English punctuation marks and newlines as sentence delimiters.
 *
 * @module services/translation/SentenceBuffer
 */

class SentenceBuffer {
  constructor() {
    this.buffer = ''
    // Sentence ending characters: Chinese punctuation, English punctuation, and newlines
    // Note: We use a character class to match single ending characters
    this.sentenceEnders = /[。？！.?!\n]/
  }

  /**
   * Add text to the buffer and extract complete sentences
   * @param {string} text - Incremental text to add
   * @returns {string[]} Array of complete sentences extracted from the buffer
   */
  add(text) {
    if (!text || typeof text !== 'string') {
      return []
    }

    this.buffer += text
    const sentences = []

    let lastEnd = 0
    const regex = new RegExp(this.sentenceEnders.source, 'g')
    let match

    while ((match = regex.exec(this.buffer)) !== null) {
      const endIndex = match.index + 1
      const sentence = this.buffer.slice(lastEnd, endIndex)
      sentences.push(sentence)
      lastEnd = endIndex
    }

    // Keep incomplete portion in the buffer
    this.buffer = this.buffer.slice(lastEnd)

    return sentences
  }

  /**
   * Flush the buffer and return any remaining content
   * @returns {string} Remaining content in the buffer
   */
  flush() {
    const remaining = this.buffer
    this.buffer = ''
    return remaining
  }

  /**
   * Reset the buffer to empty state
   */
  reset() {
    this.buffer = ''
  }

  /**
   * Get the current buffer content without modifying it
   * @returns {string} Current buffer content
   */
  peek() {
    return this.buffer
  }

  /**
   * Check if the buffer is empty
   * @returns {boolean} True if buffer is empty
   */
  isEmpty() {
    return this.buffer.length === 0
  }

  /**
   * Get the current buffer length
   * @returns {number} Buffer length in characters
   */
  get length() {
    return this.buffer.length
  }
}

module.exports = SentenceBuffer
