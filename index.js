/* global Pear */
const process = require('process')
const debounceify = require('debounceify')

const READY_MSG = 'ready'
const CLOSE_MSG = 'close'
const VERSION_MSG_PREFIX = 'Version:'

//
// main
//

function main (botPath) {
  let fork = Pear.config.fork
  let length = Pear.config.length
  let workerVersion = `${fork}.${length}`
  let sub = null

  const start = () => startWorker(
    getLink(botPath, fork, length),
    () => { if (sub) sub.destroy() }
  )
  let worker = start()

  const debouncedRestart = debounceify(async () => {
    if (workerVersion === `${fork}.${length}`) return
    console.log(`Updating worker from ${workerVersion} to ${fork}.${length}`)
    await worker.ready
    worker.close()
    await worker.closed
    worker = start()
    await worker.ready
    workerVersion = await worker.version
  })

  sub = Pear.updates((update) => {
    if (!update.app) return
    fork = update.version.fork
    length = update.version.length
    debouncedRestart()
  })
  Pear.teardown(() => sub.destroy())
}

function getLink (botPath, fork, length) {
  if (Pear.config.key === null) return botPath // dev mode

  const url = new URL(botPath, `${Pear.config.applink}/`)
  url.host = `${fork}.${length}.${url.host}`
  return url.href
}

function startWorker (runLink, onClose) {
  const pipe = Pear.worker.run(runLink, Pear.config.args)
  pipe.on('close', () => onClose())
  pipe.on('error', (err) => {
    if (err.code === 'ENOTCONN') return
    throw err
  })
  pipe.on('data', (data) => {
    const msg = data.toString()
    if (msg.startsWith('[UncaughtException]') || msg.startsWith('[UnhandledRejection]')) {
      console.log(msg)
    }
  })

  const ready = new Promise((resolve) => {
    pipe.on('data', (data) => data.toString() === READY_MSG && resolve())
    pipe.on('close', () => resolve())
  })
  const closed = new Promise((resolve) => {
    pipe.on('close', () => resolve())
  })
  const version = new Promise((resolve) => {
    pipe.on('data', (data) => {
      const msg = data.toString()
      if (msg.startsWith(VERSION_MSG_PREFIX)) {
        const res = msg.split(' ')[1]
        resolve(res)
      }
    })
  })

  const close = () => pipe.write(CLOSE_MSG)

  return { ready, closed, version, close }
}

//
// worker
//

function run (botHandler) {
  const bot = botHandler(Pear.config.args)

  const pipe = Pear.worker.pipe()
  if (!pipe) return

  process.on('uncaughtException', (err) => {
    pipe.write(`[UncaughtException] ${err?.stack || err}`)
    pipe.end()
  })
  process.on('unhandledRejection', (err) => {
    pipe.write(`[UnhandledRejection] ${err?.stack || err}`)
    pipe.end()
  })

  pipe.on('data', (data) => {
    if (data.toString() === CLOSE_MSG) {
      bot.then(async (res) => {
        if (typeof res?.close === 'function') {
          await res.close()
        } else {
          console.log('Missing close function')
        }
        pipe.end()
      })
    }
  })
  pipe.write(`${VERSION_MSG_PREFIX} ${Pear.config.fork}.${Pear.config.length}`)
  bot.then(() => pipe.write(READY_MSG))
}

module.exports = { main, run }
