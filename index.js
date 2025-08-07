/* global Pear */
const process = require('process')
const debounceify = require('debounceify')

//
// main
//

function main (botPath) {
  let fork = Pear.config.fork
  let length = Pear.config.length
  let workerVersion = `${fork}.${length}`

  let updates = null
  let worker = startWorker(getLink(botPath, fork, length), () => updates?.destroy())
  Pear.teardown(() => worker.close())

  const debouncedRestart = debounceify(async () => {
    if (workerVersion === `${fork}.${length}`) return
    console.log(`Updating worker from ${workerVersion} to ${fork}.${length}`)
    await worker.ready
    console.log('Closing old worker')
    worker.close()
    await worker.closed
    console.log('Starting new worker')
    worker = startWorker(getLink(botPath, fork, length), () => updates?.destroy())
    await worker.ready
    workerVersion = await worker.version
  })

  updates = Pear.updates((update) => {
    if (!update.app) return
    fork = update.version.fork
    length = update.version.length
    debouncedRestart()
  })
  Pear.teardown(() => updates.destroy())
}

function startWorker (runLink, onClose) {
  const readyPr = promiseWithResolvers()
  const closedPr = promiseWithResolvers()
  const versionPr = promiseWithResolvers()

  const pipe = Pear.worker.run(runLink, Pear.config.args)
  pipe.on('error', (err) => {
    console.log('Worker error', err)
    onClose()
    pipe.destroy()
  })
  pipe.on('close', () => {
    console.log('Worker closed')
    readyPr.resolve()
    closedPr.resolve()
  })
  pipe.on('data', (data) => {
    const lines = data.toString().split('\n')
    console.log('Worker data', lines)
    for (let msg of lines) {
      msg = msg.trim()
      if (!msg) continue
      msg = (() => {
        try {
          return JSON.parse(msg)
        } catch {
          return { tag: 'unknown', data: msg }
        }
      })()

      if (msg.tag === 'ready') readyPr.resolve()
      else if (msg.tag === 'version') versionPr.resolve(msg.data)
      else if (msg.tag === 'error') {
        console.log('Worker error', msg.data)
        onClose()
        pipe.destroy()
      }
    }
  })

  return {
    ready: readyPr.promise,
    closed: closedPr.promise,
    version: versionPr.promise,
    close: () => pipe.write(JSON.stringify({ tag: 'close' }) + '\n')
  }
}

function getLink (botPath, fork, length) {
  if (Pear.config.key === null) return botPath // dev mode

  const url = new URL(botPath, `${Pear.config.applink}/`)
  url.host = `${fork}.${length}.${url.host}`
  return url.href
}

function promiseWithResolvers () {
  const resolvers = {}
  const promise = new Promise((resolve, reject) => {
    resolvers.resolve = resolve
    resolvers.reject = reject
  })
  return { promise, ...resolvers }
}

//
// worker
//

async function run (botHandler) {
  const pipe = Pear.worker.pipe()
  if (pipe) { // handle uncaught errors from botHandler
    process.on('uncaughtException', (err) => {
      pipe.write(JSON.stringify({ tag: 'error', data: `${err?.stack || err}` }) + '\n')
      pipe.end()
    })
    process.on('unhandledRejection', (err) => {
      pipe.write(JSON.stringify({ tag: 'error', data: `${err?.stack || err}` }) + '\n')
      pipe.end()
    })
  }

  const bot = await botHandler(Pear.config.args)

  if (!pipe) return
  pipe.on('data', async (data) => {
    const lines = data.toString().split('\n')
    console.log('Bot data', lines)
    for (let msg of lines) {
      msg = msg.trim()
      if (!msg) continue
      msg = (() => {
        try {
          return JSON.parse(msg)
        } catch {
          return { tag: 'unknown', data: msg }
        }
      })()

      if (msg.tag === 'close') {
        if (typeof bot?.close === 'function') {
          await bot.close()
        } else {
          console.log('Missing close function')
        }
        pipe.end()
      }
    }
  })
  pipe.write(JSON.stringify({ tag: 'version', data: `${Pear.config.fork}.${Pear.config.length}` }) + '\n')
  pipe.write(JSON.stringify({ tag: 'ready' }) + '\n')
}

module.exports = { main, run }
