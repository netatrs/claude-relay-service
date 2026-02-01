/**
 * 代码块保护器
 * 用于在翻译前提取代码块，翻译后还原
 * 支持 Markdown 多行代码块 (```) 和行内代码 (`)
 */

class CodeBlockProtector {
  constructor() {
    // 多行代码块正则：匹配 ``` 开头和结尾的块
    this.codeBlockRegex = /```[\s\S]*?```/g
    // 行内代码正则：匹配单个反引号包裹的内容
    this.inlineCodeRegex = /`[^`]+`/g
  }

  /**
   * 提取代码块，替换为占位符
   * @param {string} text - 原始文本
   * @returns {{ cleanText: string, placeholders: Object }} 清理后的文本和占位符映射
   */
  extract(text) {
    if (!text || typeof text !== 'string') {
      return { cleanText: text || '', placeholders: {} }
    }

    const placeholders = {}
    let index = 0

    // 1. 先处理多行代码块（优先级高，避免被行内代码正则误匹配）
    let cleanText = text.replace(this.codeBlockRegex, (match) => {
      const key = `__CODE_BLOCK_${index++}__`
      placeholders[key] = match
      return key
    })

    // 2. 再处理行内代码
    cleanText = cleanText.replace(this.inlineCodeRegex, (match) => {
      const key = `__INLINE_CODE_${index++}__`
      placeholders[key] = match
      return key
    })

    return { cleanText, placeholders }
  }

  /**
   * 还原代码块
   * @param {string} translatedText - 翻译后的文本
   * @param {Object} placeholders - 占位符映射
   * @returns {string} 还原代码块后的文本
   */
  restore(translatedText, placeholders) {
    if (!translatedText || typeof translatedText !== 'string') {
      return translatedText || ''
    }

    if (!placeholders || Object.keys(placeholders).length === 0) {
      return translatedText
    }

    let result = translatedText

    // 按占位符顺序还原，确保正确替换
    for (const [key, value] of Object.entries(placeholders)) {
      // 使用全局替换，以防翻译模型重复了占位符
      result = result.split(key).join(value)
    }

    return result
  }

  /**
   * 检测文本是否只包含代码（提取后为空或只有空白）
   * @param {string} text - 原始文本
   * @returns {boolean} 是否只包含代码
   */
  isCodeOnly(text) {
    if (!text || typeof text !== 'string') {
      return false
    }

    const { cleanText } = this.extract(text)
    // Remove placeholders before checking if only code remains
    const withoutPlaceholders = cleanText.replace(/__CODE_BLOCK_\d+__|__INLINE_CODE_\d+__/g, '').trim()
    return !withoutPlaceholders
  }

  /**
   * 获取文本中代码块的数量
   * @param {string} text - 原始文本
   * @returns {{ codeBlocks: number, inlineCodes: number }} 代码块数量
   */
  countCodeBlocks(text) {
    if (!text || typeof text !== 'string') {
      return { codeBlocks: 0, inlineCodes: 0 }
    }

    const codeBlocks = (text.match(this.codeBlockRegex) || []).length
    // 先移除多行代码块再计算行内代码，避免重复计数
    const textWithoutBlocks = text.replace(this.codeBlockRegex, '')
    const inlineCodes = (textWithoutBlocks.match(this.inlineCodeRegex) || []).length

    return { codeBlocks, inlineCodes }
  }
}

module.exports = new CodeBlockProtector()
