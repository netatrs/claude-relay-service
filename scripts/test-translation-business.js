#!/usr/bin/env node
/**
 * 翻译功能真实业务流测试
 * 测试翻译在实际 relay 流程中的集成效果
 */
const redis = require('../src/models/redis')

async function runBusinessTests() {
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

  // ========== 1. 测试 requestTranslator 在业务场景中的行为 ==========
  console.log('\n📦 1. 请求翻译 - 真实业务场景')
  const { requestTranslator } = require('../src/services/translation')

  // 模拟已启用翻译的账户 (Redis 中存储为字符串)
  const account = {
    enableTranslation: 'true',
    translationSourceLang: 'zh',
    translationTargetLang: 'en'
  }

  // 1.1 Claude Code 典型场景: 用户用中文提需求
  const devReq = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8096,
    system: [{ type: 'text', text: 'You are a helpful coding assistant.' }],
    messages: [
      { role: 'user', content: '帮我写一个 Node.js 的 HTTP 服务器，监听 3000 端口，返回 JSON 格式的响应' }
    ]
  }
  const devResult = await requestTranslator.translateRequest(devReq, account)
  const devContent = devResult.messages[0].content
  assert('开发需求翻译', typeof devContent === 'string' && devContent.length > 10, devContent.slice(0, 80))
  assert('system 不被翻译', devResult.system[0].text === 'You are a helpful coding assistant.')
  assert('model 不变', devResult.model === 'claude-sonnet-4-20250514')
  assert('原始请求不被修改', devReq.messages[0].content === '帮我写一个 Node.js 的 HTTP 服务器，监听 3000 端口，返回 JSON 格式的响应')

  // 1.2 多轮对话场景
  console.log('\n📦 2. 多轮对话翻译')
  const multiTurnReq = {
    model: 'claude-sonnet-4-20250514',
    messages: [
      { role: 'user', content: '请帮我解释一下 Promise 和 async/await 的区别' },
      { role: 'assistant', content: 'Promise is a built-in JavaScript object...' },
      { role: 'user', content: '能给我一个具体的例子吗？用 TypeScript 写' }
    ]
  }
  const multiResult = await requestTranslator.translateRequest(multiTurnReq, account)
  assert('第一条用户消息被翻译', multiResult.messages[0].content !== '请帮我解释一下 Promise 和 async/await 的区别')
  assert('assistant 消息不翻译', multiResult.messages[1].content === 'Promise is a built-in JavaScript object...')
  assert('第二条用户消息被翻译', multiResult.messages[2].content !== '能给我一个具体的例子吗？用 TypeScript 写')
  assert('技术术语 Promise 保留', multiResult.messages[0].content.toLowerCase().includes('promise'))
  assert('技术术语 async/await 保留', multiResult.messages[0].content.toLowerCase().includes('async'))
  assert('TypeScript 保留', multiResult.messages[2].content.toLowerCase().includes('typescript'))

  // 1.3 代码块保护场景 (Claude Code 最常见)
  console.log('\n📦 3. 代码块保护 - 核心业务场景')
  const codeReq = {
    model: 'claude-sonnet-4-20250514',
    messages: [
      {
        role: 'user',
        content:
          '这段代码有 bug，帮我修复一下：\n```javascript\nfunction add(a, b) {\n  return a - b; // 应该是加法\n}\nconsole.log(add(1, 2));\n```\n错误信息是 `Expected 3 but got -1`'
      }
    ]
  }
  const codeResult = await requestTranslator.translateRequest(codeReq, account)
  const codeContent = codeResult.messages[0].content
  assert('代码块完整保留', codeContent.includes('function add(a, b)'))
  assert('代码注释保留', codeContent.includes('return a - b'))
  assert('console.log 保留', codeContent.includes('console.log(add(1, 2))'))
  assert('行内代码保留', codeContent.includes('`Expected 3 but got -1`'))
  assert('中文描述被翻译', !codeContent.startsWith('这段代码'))

  // 1.4 tool_use / tool_result 场景 (Claude Code Agent 模式)
  console.log('\n📦 4. Tool Use/Result 场景')
  const toolReq = {
    model: 'claude-sonnet-4-20250514',
    messages: [
      { role: 'user', content: '请帮我读取 package.json 文件' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'Read',
            input: { file_path: '/path/to/package.json' }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01',
            content: '{"name": "my-app", "version": "1.0.0"}'
          }
        ]
      },
      { role: 'user', content: '请分析这个 package.json 的依赖是否需要更新' }
    ]
  }
  const toolResult = await requestTranslator.translateRequest(toolReq, account)
  assert(
    '第一条用户消息翻译',
    toolResult.messages[0].content !== '请帮我读取 package.json 文件'
  )
  assert('tool_use 完整保留', toolResult.messages[1].content[0].type === 'tool_use')
  assert('tool_use id 保留', toolResult.messages[1].content[0].id === 'toolu_01')
  assert(
    'tool_result 不翻译',
    toolResult.messages[2].content[0].content === '{"name": "my-app", "version": "1.0.0"}'
  )
  assert(
    '后续用户消息翻译',
    toolResult.messages[3].content !== '请分析这个 package.json 的依赖是否需要更新'
  )

  // 1.5 纯英文消息不翻译 (避免不必要的 API 调用)
  console.log('\n📦 5. 英文消息跳过翻译')
  const enReq = {
    model: 'claude-sonnet-4-20250514',
    messages: [
      { role: 'user', content: 'Write a function that reverses a string in Python' },
      { role: 'assistant', content: 'Here is a Python function...' },
      { role: 'user', content: 'Can you add type hints?' }
    ]
  }
  const enResult = await requestTranslator.translateRequest(enReq, account)
  assert(
    '英文消息1不翻译',
    enResult.messages[0].content === 'Write a function that reverses a string in Python'
  )
  assert('英文消息2不翻译', enResult.messages[2].content === 'Can you add type hints?')

  // 1.6 多模态消息 (截图 + 中文描述)
  console.log('\n📦 6. 多模态消息翻译')
  const imageReq = {
    model: 'claude-sonnet-4-20250514',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '请看这张截图，帮我分析页面布局的问题' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo...' }
          },
          { type: 'text', text: '特别注意导航栏和侧边栏的对齐' }
        ]
      }
    ]
  }
  const imageResult = await requestTranslator.translateRequest(imageReq, account)
  const imgContent = imageResult.messages[0].content
  assert('text block 1 被翻译', imgContent[0].text !== '请看这张截图，帮我分析页面布局的问题')
  assert('image block 完整保留', imgContent[1].type === 'image' && imgContent[1].source.data === 'iVBORw0KGgo...')
  assert('text block 2 被翻译', imgContent[2].text !== '特别注意导航栏和侧边栏的对齐')

  // ========== 7. 响应翻译 - 模拟 SSE 流 ==========
  console.log('\n📦 7. 响应翻译 - SSE 流模拟')
  const { ResponseTranslator } = require('../src/services/translation')

  const sseEvents = []
  const mockRes = {
    writable: true,
    write: (chunk) => {
      const str = chunk.toString()
      // Parse SSE data lines
      str.split('\n').forEach((line) => {
        if (line.startsWith('data: ')) {
          try {
            sseEvents.push(JSON.parse(line.slice(6)))
          } catch (e) {
            // ignore parse errors for non-JSON lines
          }
        }
      })
      return true
    }
  }

  const rt = new ResponseTranslator(
    { enableTranslation: 'true', translationSourceLang: 'en', translationTargetLang: 'zh' },
    mockRes
  )

  // Simulate a typical Claude response with text and tool_use
  // message_start
  await rt.processEvent({ type: 'message_start', message: { id: 'msg_01', role: 'assistant' } })

  // text content block
  await rt.processEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  })

  // Simulate streaming text deltas
  const textParts = [
    'Here is a simple ',
    'HTTP server in Node.js.',
    ' It listens on port 3000.',
    '\n```javascript\n',
    'const http = require("http");\n',
    'const server = http.createServer((req, res) => {\n',
    '  res.writeHead(200, {"Content-Type": "application/json"});\n',
    '  res.end(JSON.stringify({hello: "world"}));\n',
    '});\n',
    'server.listen(3000);\n',
    '```\n',
    'This code creates a basic server.'
  ]

  for (const part of textParts) {
    await rt.processEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: part }
    })
  }

  await rt.processEvent({ type: 'content_block_stop', index: 0 })

  // tool_use content block
  await rt.processEvent({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'toolu_02', name: 'Write' }
  })
  await rt.processEvent({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"file_path":"/tmp/server.js","content":"const http"}' }
  })
  await rt.processEvent({ type: 'content_block_stop', index: 1 })

  // message end
  await rt.processEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
  await rt.processEvent({ type: 'message_stop' })

  if (rt.finalize) await rt.finalize()

  const stats = rt.getStats()
  console.log('  Response translator stats:', JSON.stringify(stats))
  assert('SSE events emitted', sseEvents.length > 0, 'events: ' + sseEvents.length)
  assert('text deltas processed', stats.textDeltas > 0, 'deltas: ' + stats.textDeltas)
  assert('total events tracked', stats.totalEvents > 0)

  // Check that tool_use events pass through
  const toolUseEvents = sseEvents.filter(
    (e) => e.type === 'content_block_start' && e.content_block?.type === 'tool_use'
  )
  assert('tool_use event passed through', toolUseEvents.length === 1)

  // ========== 8. 账户翻译配置集成 ==========
  console.log('\n📦 8. 账户翻译配置')

  // 8.1 enableTranslation = 'true' (Redis 字符串)
  const acc1 = { enableTranslation: 'true' }
  const req1 = { model: 'x', messages: [{ role: 'user', content: '你好' }] }
  const res1 = await requestTranslator.translateRequest(req1, acc1)
  assert('enableTranslation="true" 启用翻译', res1.messages[0].content !== '你好')

  // 8.2 enableTranslation = true (布尔值)
  const acc2 = { enableTranslation: true }
  const res2 = await requestTranslator.translateRequest(req1, acc2)
  assert('enableTranslation=true 启用翻译', res2.messages[0].content !== '你好')

  // 8.3 enableTranslation = 'false' (字符串 false - JS中是truthy!)
  const acc3 = { enableTranslation: 'false' }
  const res3 = await requestTranslator.translateRequest(req1, acc3)
  // 注意: 'false' 字符串在 JS 中是 truthy! 这是个潜在问题
  console.log('  ⚠️  enableTranslation="false" (string): 行为取决于实现')
  console.log('    实际结果:', res3.messages[0].content === '你好' ? '未翻译' : '已翻译')

  // 8.4 enableTranslation = false (布尔 false)
  const acc4 = { enableTranslation: false }
  const res4 = await requestTranslator.translateRequest(req1, acc4)
  assert('enableTranslation=false 不翻译', res4.messages[0].content === '你好')

  // 8.5 无 enableTranslation 字段
  const acc5 = { name: 'test' }
  const res5 = await requestTranslator.translateRequest(req1, acc5)
  assert('无 enableTranslation 不翻译', res5.messages[0].content === '你好')

  // ========== 9. 翻译缓存效果 ==========
  console.log('\n📦 9. 翻译缓存效果')
  const { translationService } = require('../src/services/translation')
  translationService.clearCache()

  const start1 = Date.now()
  await translationService.translate('这是一段测试文本，用于验证缓存效果', 'zh', 'en')
  const firstCall = Date.now() - start1

  const start2 = Date.now()
  await translationService.translate('这是一段测试文本，用于验证缓存效果', 'zh', 'en')
  const secondCall = Date.now() - start2

  const stats2 = translationService.getCacheStats()
  assert('第一次调用走 API', firstCall > 100, firstCall + 'ms')
  assert('第二次调用走缓存', secondCall < 10, secondCall + 'ms')
  assert('缓存命中次数', stats2.hits >= 1, 'hits=' + stats2.hits)

  // ========== 10. 边界情况 ==========
  console.log('\n📦 10. 边界情况')

  // 10.1 空消息数组
  const emptyMsgs = { model: 'x', messages: [] }
  const emptyResult = await requestTranslator.translateRequest(emptyMsgs, account)
  assert('空消息数组不报错', emptyResult.messages.length === 0)

  // 10.2 超长文本
  const longText = '请帮我优化以下代码的性能。' + '这段代码运行很慢。'.repeat(10)
  const longReq = { model: 'x', messages: [{ role: 'user', content: longText }] }
  const longResult = await requestTranslator.translateRequest(longReq, account)
  assert('超长文本翻译成功', longResult.messages[0].content !== longText, 'len=' + longResult.messages[0].content.length)

  // 10.3 混合中英文
  const mixedReq = {
    model: 'x',
    messages: [
      { role: 'user', content: '请帮我 debug 这个 React component 的 useState hook' }
    ]
  }
  const mixedResult = await requestTranslator.translateRequest(mixedReq, account)
  const mixedContent = mixedResult.messages[0].content
  assert('混合文本翻译', mixedContent !== mixedReq.messages[0].content)
  assert('React 保留', mixedContent.toLowerCase().includes('react'))
  assert('useState 保留', mixedContent.includes('useState') || mixedContent.toLowerCase().includes('usestate'))

  // ========== Summary ==========
  console.log('\n' + '='.repeat(50))
  console.log(`📊 Business Test Results: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(50))

  process.exit(failed > 0 ? 1 : 0)
}

runBusinessTests().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
