/**
 * 语言检测器
 * 用于检测文本中是否包含中文或英文字符
 */

class LanguageDetector {
  constructor() {
    // 中文字符范围（CJK统一汉字基本区）
    this.chineseRegex = /[\u4e00-\u9fa5]/
    // 中文字符全局匹配
    this.chineseGlobalRegex = /[\u4e00-\u9fa5]/g
    // 英文字母
    this.englishRegex = /[a-zA-Z]/
    // 英文字母全局匹配
    this.englishGlobalRegex = /[a-zA-Z]/g
  }

  /**
   * 检测文本是否包含中文字符
   * @param {string} text - 待检测文本
   * @returns {boolean} 是否包含中文
   */
  containsChinese(text) {
    if (!text || typeof text !== 'string') {
      return false
    }
    return this.chineseRegex.test(text)
  }

  /**
   * 检测文本是否主要是中文
   * 中文字符占非空白字符的比例超过30%则认为是主要中文
   * @param {string} text - 待检测文本
   * @returns {boolean} 是否主要是中文
   */
  isPrimarilyChinese(text) {
    if (!text || typeof text !== 'string') {
      return false
    }

    const chineseChars = (text.match(this.chineseGlobalRegex) || []).length
    // 移除所有空白字符后计算总字符数
    const totalChars = text.replace(/\s/g, '').length

    if (totalChars === 0) {
      return false
    }

    return chineseChars / totalChars > 0.3
  }

  /**
   * 检测文本是否包含英文字符
   * @param {string} text - 待检测文本
   * @returns {boolean} 是否包含英文
   */
  containsEnglish(text) {
    if (!text || typeof text !== 'string') {
      return false
    }
    return this.englishRegex.test(text)
  }

  /**
   * 检测文本是否主要是英文
   * 英文字母占非空白字符的比例超过50%则认为是主要英文
   * @param {string} text - 待检测文本
   * @returns {boolean} 是否主要是英文
   */
  isPrimarilyEnglish(text) {
    if (!text || typeof text !== 'string') {
      return false
    }

    const englishChars = (text.match(this.englishGlobalRegex) || []).length
    const totalChars = text.replace(/\s/g, '').length

    if (totalChars === 0) {
      return false
    }

    return englishChars / totalChars > 0.5
  }

  /**
   * 获取文本的语言统计信息
   * @param {string} text - 待检测文本
   * @returns {{ chinese: number, english: number, total: number, chineseRatio: number, englishRatio: number }}
   */
  getLanguageStats(text) {
    if (!text || typeof text !== 'string') {
      return {
        chinese: 0,
        english: 0,
        total: 0,
        chineseRatio: 0,
        englishRatio: 0
      }
    }

    const chineseChars = (text.match(this.chineseGlobalRegex) || []).length
    const englishChars = (text.match(this.englishGlobalRegex) || []).length
    const totalChars = text.replace(/\s/g, '').length

    return {
      chinese: chineseChars,
      english: englishChars,
      total: totalChars,
      chineseRatio: totalChars > 0 ? chineseChars / totalChars : 0,
      englishRatio: totalChars > 0 ? englishChars / totalChars : 0
    }
  }

  /**
   * 检测文本的主要语言
   * @param {string} text - 待检测文本
   * @returns {'chinese' | 'english' | 'mixed' | 'unknown'} 主要语言
   */
  detectPrimaryLanguage(text) {
    if (!text || typeof text !== 'string') {
      return 'unknown'
    }

    const stats = this.getLanguageStats(text)

    if (stats.total === 0) {
      return 'unknown'
    }

    if (stats.chineseRatio > 0.3) {
      return 'chinese'
    }

    if (stats.englishRatio > 0.5) {
      return 'english'
    }

    if (stats.chinese > 0 && stats.english > 0) {
      return 'mixed'
    }

    return 'unknown'
  }
}

module.exports = new LanguageDetector()
