/* global Pear */

const pearRun = require('pear-run')
const pipe = pearRun(`pear://${Pear.config.args[0]}/test/fixtures/worker/child/main.js`)

pipe.on('data', (data) => {
  const lines = data.toString().split('\n')
  for (let msg of lines) {
    msg = msg.trim()
    if (!msg) continue
    const obj = parseMsg(msg)

    if (obj.tag === 'data') {
      console.log(obj.data)
      pipe.write('Test parent close')
    } else if (obj.tag === 'error') {
      console.log('Test parent error', obj.data)
    }
  }
})

pipe.on('close', () => {
  console.log('Test parent closed')
})

function parseMsg (msg) {
  try {
    return JSON.parse(msg)
  } catch {
    return { tag: 'unknown', data: msg }
  }
}
