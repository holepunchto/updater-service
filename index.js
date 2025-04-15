/* global Pear */

const debounceify = require('debounceify')

const isDev = Pear.config.key === null

const READY_MSG = 'ready'

//
// main
//

function main (botPath) {
  const runLink = isDev ? botPath : new URL(botPath, `${Pear.config.applink}/`).href

  let worker = runWorker(runLink)

  Pear.updates(debounceify(async () => {
    await worker.ready
    worker.close()
    await worker.closed
    worker = runWorker(runLink)
    await worker.ready
  }))
}

function runWorker (runLink) {
  const pipe = Pear.worker.run(runLink, Pear.config.args)
  const ready = new Promise((resolve) => {
    pipe.on('data', (data) => data.toString() === READY_MSG && resolve())
  })
  const closed = new Promise((resolve) => {
    pipe.on('close', () => resolve())
  })
  const close = () => pipe.end()
  return { ready, closed, close }
}

//
// worker
//

function run (botHandler) {
  const bot = botHandler(Pear.config.args, {
    getVersions: Pear.versions
  })
  const pipe = Pear.worker.pipe()
  if (pipe) {
    bot.then(() => pipe.write(READY_MSG))
    pipe.on('end', () => bot.then((res) => {
      if (typeof res === 'object' && 'close' in res && typeof res.close === 'function') {
        res.close()
        return
      }
      console.error('Missing close function')
    }))
  }
}

module.exports = { main, run }
