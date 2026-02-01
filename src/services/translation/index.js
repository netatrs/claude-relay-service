/**
 * 翻译功能模块入口
 * 导出所有翻译相关的服务和工具
 */

const codeBlockProtector = require('./codeBlockProtector')
const languageDetector = require('./languageDetector')
const SentenceBuffer = require('./sentenceBuffer')
const translationService = require('./translationService')
const requestTranslator = require('./requestTranslator')
const ResponseTranslator = require('./responseTranslator')

module.exports = {
  // 代码块保护器（单例）
  codeBlockProtector,

  // 语言检测器（单例）
  languageDetector,

  // 句子缓冲器（类，需要实例化）
  SentenceBuffer,

  // 翻译服务（单例）
  translationService,

  // 请求翻译器（单例）
  requestTranslator,

  // 响应翻译器（类，需要实例化）
  ResponseTranslator
}
