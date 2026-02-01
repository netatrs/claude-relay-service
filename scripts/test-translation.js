#!/usr/bin/env node
/**
 * Comprehensive Translation Feature Test
 */
const redis = require('../src/models/redis')

async function runTests() {
  await redis.connect()

  let passed = 0
  let failed = 0

  function assert(name, condition, detail) {
    if (condition) {
      console.log('  ✅', name, detail ? '- ' + detail : '')
      passed++
    } else {
      console.log('  ❌', name, detail ? '- ' + detail : '')
      failed++
    }
  }

  function placeholderCount(ph) {
    return Object.keys(ph).length
  }

  // ========== 1. codeBlockProtector ==========
  console.log('\n📦 1. codeBlockProtector')
  const { codeBlockProtector } = require('../src/services/translation')

  // placeholders is an Object (not Array)
  const code1 = 'Hello `inline` world\n```js\nconst x = 1;\n```\nEnd'
  const { cleanText, placeholders } = codeBlockProtector.extract(code1)
  assert('extract code blocks', placeholderCount(placeholders) === 2, 'found ' + placeholderCount(placeholders))
  assert(
    'clean text has placeholders',
    cleanText.includes('__CODE_BLOCK_') || cleanText.includes('__INLINE_CODE_')
  )

  const restored = codeBlockProtector.restore(cleanText, placeholders)
  assert('restore code blocks', restored.includes('const x = 1;'))
  assert('restore inline code', restored.includes('`inline`'))

  // isCodeOnly: 纯代码块
  const pureCode = '```js\ncode\n```'
  assert('isCodeOnly - code block', codeBlockProtector.isCodeOnly(pureCode))
  assert('isCodeOnly - plain text', !codeBlockProtector.isCodeOnly('just text'))

  // 空文本
  const emptyResult = codeBlockProtector.extract('')
  assert('extract empty text', placeholderCount(emptyResult.placeholders) === 0)

  // 无代码文本
  const noCode = codeBlockProtector.extract('纯文本无代码')
  assert('extract no code text', noCode.cleanText === '纯文本无代码' && placeholderCount(noCode.placeholders) === 0)

  // 多个代码块
  const multiCode = '```py\nprint(1)\n```\nText\n```go\nfmt.Println()\n```'
  const multi = codeBlockProtector.extract(multiCode)
  assert('multiple code blocks', placeholderCount(multi.placeholders) === 2, 'found ' + placeholderCount(multi.placeholders))

  // countCodeBlocks
  const counts = codeBlockProtector.countCodeBlocks(code1)
  assert('countCodeBlocks', counts.codeBlocks === 1 && counts.inlineCodes === 1, JSON.stringify(counts))

  // ========== 2. languageDetector ==========
  console.log('\n📦 2. languageDetector')
  const { languageDetector } = require('../src/services/translation')

  assert('containsChinese - zh', languageDetector.containsChinese('你好'))
  assert('containsChinese - en', !languageDetector.containsChinese('hello'))
  assert('isPrimarilyChinese - zh', languageDetector.isPrimarilyChinese('这是一段中文'))
  assert('isPrimarilyChinese - en', !languageDetector.isPrimarilyChinese('This is English'))
  assert('containsEnglish - en', languageDetector.containsEnglish('hello'))
  assert('containsEnglish - zh', !languageDetector.containsEnglish('你好世界'))
  assert('isPrimarilyEnglish', languageDetector.isPrimarilyEnglish('This is English'))

  const lang = languageDetector.detectPrimaryLanguage('你好世界')
  assert('detect chinese', lang === 'chinese', 'got: ' + lang)
  const lang2 = languageDetector.detectPrimaryLanguage('Hello World')
  assert('detect english', lang2 === 'english', 'got: ' + lang2)

  // getLanguageStats returns { chinese, english, total, chineseRatio, englishRatio }
  const stats = languageDetector.getLanguageStats('Hello你好')
  assert(
    'getLanguageStats',
    stats.chinese > 0 && stats.english > 0,
    `zh:${stats.chinese} en:${stats.english}`
  )

  // edge cases
  assert('empty string', languageDetector.detectPrimaryLanguage('') === 'unknown')
  assert('numbers only', !languageDetector.containsChinese('12345'))
  assert('mixed with code', languageDetector.containsChinese('运行 npm install'))

  // ========== 3. SentenceBuffer ==========
  console.log('\n📦 3. SentenceBuffer')
  const { SentenceBuffer } = require('../src/services/translation')
  const buf = new SentenceBuffer()

  let sentences = buf.add('Hello world')
  assert('incomplete buffered', sentences.length === 0)
  sentences = buf.add('. Done.')
  assert('complete sentence on period', sentences.length >= 1, 'got ' + sentences.length)

  buf.reset()
  sentences = buf.add('你好世界。')
  assert('Chinese period', sentences.length === 1, sentences[0])

  buf.reset()
  sentences = buf.add('问题？回答！结束。')
  assert('multiple CN punctuations', sentences.length >= 2, 'got ' + sentences.length)

  buf.reset()
  buf.add('Incomplete')
  const flushed = buf.flush()
  assert('flush remaining', flushed === 'Incomplete')
  assert('empty after flush', buf.isEmpty())

  buf.reset()
  sentences = buf.add('Line one\nLine two\n')
  assert('newline boundary', sentences.length >= 1, 'got ' + sentences.length)

  buf.reset()
  assert('peek empty', buf.peek() === '')
  buf.add('test')
  assert('peek non-empty', buf.peek() === 'test')
  assert('length property', buf.length === 4)

  // ========== 4. translationService (API) ==========
  console.log('\n📦 4. translationService (API calls)')
  const { translationService } = require('../src/services/translation')

  assert('isEnabled', translationService.isEnabled())
  assert('getModel', translationService.getModel() === 'qwen3-8b', translationService.getModel())

  // 4.1 中→英
  const zhToEn = await translationService.translate('你好世界', 'zh', 'en')
  assert('zh->en basic', zhToEn.toLowerCase().includes('hello'), zhToEn)

  // 4.2 英→中
  const enToZh = await translationService.translate('Good morning', 'en', 'zh')
  assert('en->zh basic', languageDetector.containsChinese(enToZh), enToZh)

  // 4.3 边界情况
  assert('empty passthrough', (await translationService.translate('', 'zh', 'en')) === '')
  assert('null passthrough', (await translationService.translate(null, 'zh', 'en')) === null)
  assert('same lang passthrough', (await translationService.translate('Hello', 'en', 'en')) === 'Hello')

  // 4.4 缓存
  const cached = await translationService.translate('你好世界', 'zh', 'en')
  assert('cache hit same result', cached === zhToEn)
  const cacheStats = translationService.getCacheStats()
  assert('cache has hits', cacheStats.hits >= 1, 'hits: ' + cacheStats.hits)

  // 4.5 较长文本
  const longText = '这是较长的中文文本，用于测试翻译服务处理多句话的能力。翻译质量应该保持自然流畅。'
  const longResult = await translationService.translate(longText, 'zh', 'en')
  assert('long text translated', longResult.length > 20, 'len: ' + longResult.length)

  // 4.6 技术文本
  const techText = '请使用 React 框架开发前端应用'
  const techResult = await translationService.translate(techText, 'zh', 'en')
  assert('tech text with React', techResult.toLowerCase().includes('react'), techResult)

  // 4.7 unsupported language pair
  try {
    await translationService.translate('test', 'ja', 'en')
    assert('unsupported lang throws', false)
  } catch (e) {
    assert('unsupported lang throws', e.message.includes('Unsupported'), e.message)
  }

  // 4.8 清除缓存
  const beforeClear = translationService.getCacheStats().size
  translationService.clearCache()
  assert('clearCache', translationService.getCacheStats().size === 0, 'was: ' + beforeClear)

  // ========== 5. requestTranslator ==========
  console.log('\n📦 5. requestTranslator')
  const { requestTranslator } = require('../src/services/translation')
  // enableTranslation is truthy check - 'true' string is truthy, 'false' string is also truthy!
  // The code checks `!account?.enableTranslation` so any truthy value enables translation
  const mockAccount = {
    enableTranslation: 'true',
    translationSourceLang: 'zh',
    translationTargetLang: 'en'
  }

  // 5.1 基本翻译
  const reqBody = {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: '请帮我写一个函数' }]
  }
  const translatedReq = await requestTranslator.translateRequest(reqBody, mockAccount)
  assert(
    'request translated',
    translatedReq.messages[0].content !== '请帮我写一个函数',
    translatedReq.messages[0].content.slice(0, 60)
  )
  assert('original not modified', reqBody.messages[0].content === '请帮我写一个函数')

  // 5.2 英文消息不翻译
  const enReq = { model: 'x', messages: [{ role: 'user', content: 'Write a function' }] }
  const enResult = await requestTranslator.translateRequest(enReq, mockAccount)
  assert('english not translated', enResult.messages[0].content === 'Write a function')

  // 5.3 tool_result 不翻译 (tool_result is an array content with type 'tool_result', not type 'text')
  const toolReq = {
    model: 'x',
    messages: [
      { role: 'user', content: '请帮我' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'read', input: {} }] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'x', content: '文件内容' }]
      }
    ]
  }
  const toolResult = await requestTranslator.translateRequest(toolReq, mockAccount)
  // tool_result blocks are not type 'text', so they should not be translated
  assert('tool_result not translated', JSON.stringify(toolResult.messages[2]).includes('文件内容'))

  // 5.4 assistant 消息不翻译
  const assistantReq = {
    model: 'x',
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: 'I am Claude' },
      { role: 'user', content: '谢谢' }
    ]
  }
  const assistantResult = await requestTranslator.translateRequest(assistantReq, mockAccount)
  assert('assistant not translated', assistantResult.messages[1].content === 'I am Claude')

  // 5.5 禁用翻译 - enableTranslation 为 falsy (null/undefined/false/0/'')
  const disabled = await requestTranslator.translateRequest(reqBody, { enableTranslation: false })
  assert('disabled (false) passthrough', disabled.messages[0].content === '请帮我写一个函数')

  const disabled2 = await requestTranslator.translateRequest(reqBody, { enableTranslation: null })
  assert('disabled (null) passthrough', disabled2.messages[0].content === '请帮我写一个函数')

  const disabled3 = await requestTranslator.translateRequest(reqBody, { enableTranslation: '' })
  assert('disabled (empty) passthrough', disabled3.messages[0].content === '请帮我写一个函数')

  // 5.6 无 account
  const noAccount = await requestTranslator.translateRequest(reqBody, null)
  assert('null account passthrough', noAccount.messages[0].content === '请帮我写一个函数')

  // 5.7 多模态内容（数组格式）
  const multiModalReq = {
    model: 'x',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '请描述这张图片' },
          { type: 'image', source: { type: 'base64', data: 'abc' } }
        ]
      }
    ]
  }
  const multiResult = await requestTranslator.translateRequest(multiModalReq, mockAccount)
  assert(
    'multimodal text translated',
    multiResult.messages[0].content[0].text !== '请描述这张图片',
    multiResult.messages[0].content[0].text.slice(0, 40)
  )
  assert('multimodal image preserved', multiResult.messages[0].content[1].type === 'image')

  // ========== 6. ResponseTranslator ==========
  console.log('\n📦 6. ResponseTranslator')
  const { ResponseTranslator } = require('../src/services/translation')
  const chunks = []
  const mockOutput = { write: (chunk) => chunks.push(chunk.toString()) }

  const rt = new ResponseTranslator(mockAccount, mockOutput)
  assert('created', rt !== null)
  assert('enabled', rt.isEnabled())

  // 6.1 text content block
  await rt.processEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  })
  await rt.processEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello world.' }
  })
  await rt.processEvent({
    type: 'content_block_stop',
    index: 0
  })

  // 6.2 tool_use content block (should pass through)
  await rt.processEvent({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 't1', name: 'read_file' }
  })
  await rt.processEvent({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"path":"/tmp"}' }
  })
  await rt.processEvent({
    type: 'content_block_stop',
    index: 1
  })

  const rstats = rt.getStats()
  assert('stats tracked', rstats.totalEvents > 0, 'events: ' + rstats.totalEvents)
  assert('text deltas counted', rstats.textDeltas >= 1, 'deltas: ' + rstats.textDeltas)

  // 6.3 disabled ResponseTranslator
  const drt = new ResponseTranslator({ enableTranslation: false }, mockOutput)
  assert('disabled RT', !drt.isEnabled())

  // 6.4 non-stream events pass through
  await rt.processEvent({ type: 'message_start', message: {} })
  await rt.processEvent({ type: 'message_delta', delta: {} })
  await rt.processEvent({ type: 'message_stop' })
  const rstats2 = rt.getStats()
  assert('non-content events pass', rstats2.totalEvents > rstats.totalEvents)

  // ========== 7. 集成测试: 代码块保护 + 翻译 ==========
  console.log('\n📦 7. Integration: code protection + translation')

  const codeText = '请运行以下命令：\n```bash\nnpm install express\n```\n然后创建 `index.js` 文件。'
  const { cleanText: ct, placeholders: ph } = codeBlockProtector.extract(codeText)
  assert('code extracted before translate', placeholderCount(ph) === 2, 'placeholders: ' + placeholderCount(ph))

  const translatedClean = await translationService.translate(ct, 'zh', 'en')
  const finalText = codeBlockProtector.restore(translatedClean, ph)
  assert(
    'code preserved after translate',
    finalText.includes('npm install express'),
    finalText.slice(0, 100)
  )
  assert('inline code preserved', finalText.includes('`index.js`'), finalText)

  // 完整的请求翻译集成
  const integReq = {
    model: 'x',
    messages: [
      {
        role: 'user',
        content: '请帮我运行 `git status` 查看状态，然后执行以下命令：\n```bash\ngit add .\ngit commit -m "fix"\n```'
      }
    ]
  }
  const integResult = await requestTranslator.translateRequest(integReq, mockAccount)
  const integContent = integResult.messages[0].content
  assert('integration: text translated', !languageDetector.isPrimarilyChinese(integContent), integContent.slice(0, 80))
  assert('integration: code block preserved', integContent.includes('git add .'))
  assert('integration: inline code preserved', integContent.includes('`git status`'))

  // ========== Summary ==========
  console.log('\n' + '='.repeat(50))
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(50))

  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch((e) => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
