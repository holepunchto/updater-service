/* global Pear */
const process = require('process')
const debounceify = require('debounceify')

const DEV = Pear.config.key === null

//
// main
//

const DELAY_UPDATE = DEV ? 1000 : 60000

function main (botPath, watchPrefixes = ['/src']) {
  let diff = []
  let fork = Pear.config.fork
  let length = Pear.config.length
  let workerVersion = `${fork}.${length}`

  let updates = null
  let worker = startWorker(getLink(botPath, fork, length), () => updates?.destroy())
  Pear.teardown(() => worker.close())

  const debouncedRestart = debounceify(async () => {
    await new Promise(resolve => setTimeout(resolve, DELAY_UPDATE)) // wait for the final update
    if (DEV && !hasUpdateDev(watchPrefixes, diff)) return
    if (!DEV && workerVersion === `${fork}.${length}`) return
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
    diff = update.diff || []
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
  if (DEV) return botPath // dev mode

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

function hasUpdateDev (watchPrefixes, diff) {
  for (const { key } of diff) {
    if (!key.endsWith('.js')) continue
    if (!watchPrefixes.some(prefix => key.startsWith(prefix))) continue
    return true
  }
  return false
}

//
// worker
//

async function run (botRunner) {
  const pipe = Pear.worker.pipe()
  if (pipe) { // handle uncaught errors from botRunner
    process.on('uncaughtException', (err) => {
      pipe.write(JSON.stringify({ tag: 'error', data: `${err?.stack || err}` }) + '\n')
      pipe.end()
    })
    process.on('unhandledRejection', (err) => {
      pipe.write(JSON.stringify({ tag: 'error', data: `${err?.stack || err}` }) + '\n')
      pipe.end()
    })
  }

  const runner = await botRunner(Pear.config.args)

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
        if (typeof runner?.close === 'function') {
          await runner.close()
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
