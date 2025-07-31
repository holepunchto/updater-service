/* global Pear */

const debounceify = require('debounceify')

const isDev = Pear.config.key === null

const READY_MSG = 'ready'
const CLOSE_MSG = 'close'

//
// main
//

function main (botPath) {
  const runLink = isDev ? botPath : new URL(botPath, `${Pear.config.applink}/`).href

  let worker = runWorker(runLink)

  const sub = Pear.updates(debounceify(async () => {
    await worker.ready
    worker.close()
    await worker.closed
    worker = runWorker(runLink)
    await worker.ready
  }))
  Pear.teardown(() => sub.destroy())
}

function runWorker (runLink) {
  const pipe = Pear.worker.run(runLink, Pear.config.args)
  pipe.on('error', (err) => {
    if (err.code === 'ENOTCONN') return
    throw err
  })
  const ready = new Promise((resolve) => {
    pipe.on('data', (data) => data.toString() === READY_MSG && resolve())
    pipe.on('close', () => resolve())
  })
  const closed = new Promise((resolve) => {
    pipe.on('close', () => resolve())
  })
  const close = () => pipe.write(CLOSE_MSG)
  return { ready, closed, close }
}

//
// worker
//

function run (botHandler) {
  const bot = botHandler(Pear.config.args)
  bot.catch(console.log)
  const pipe = Pear.worker.pipe()
  bot.then(() => pipe.write(READY_MSG))
  pipe.on('data', (data) => {
    if (data.toString() === CLOSE_MSG) {
      bot.then(async (res) => {
        if (typeof res === 'object' && 'close' in res && typeof res.close === 'function') {
          await res.close()
        } else {
          console.log('Missing close function.')
        }
        pipe.end()
      })
    }
  })
}

module.exports = { main, run }
