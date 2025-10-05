/**
 * @typedef {function(string): void} OnData
 * @typedef {function(string): void} OnError
 * @typedef {function(string): Promise} Write
 * @typedef {function(): Promise} Close
 */
/* global Pear */
const rrp = require('resolve-reject-promise')
const process = require('process')
const debounceify = require('debounceify')

const DEV = Pear.config.key === null

//
// main
//

/**
 * @type {function(string, {
 *   delayUpdate?: number,
 *   watchPrefixes?: string[],
 * }): void}
 */
function main (botPath, opts = {}) {
  const {
    delayUpdate = DEV ? 1000 : (Math.floor(Math.random() * (30 - 10 + 1)) + 10) * 1000, // 10-30s
    watchPrefixes = ['/src']
  } = opts

  let onData = console.log
  let onError = console.log
  const pipe = Pear.worker.pipe()
  if (pipe) {
    onData = (data) => pipe.write(JSON.stringify({ tag: 'data', data }) + '\n')
    onError = (data) => pipe.write(JSON.stringify({ tag: 'error', data }) + '\n')
  }

  let diff = []
  let fork = Pear.config.fork
  let length = Pear.config.length
  let workerVersion = `${fork}.${length}`
  let updates = null

  const start = () => startWorker(
    getLink(botPath, fork, length),
    (data) => onData(data),
    (err) => {
      updates?.destroy()
      onError(err)
      if (pipe) pipe.end()
    }
  )
  let worker = start()

  const close = async () => {
    updates?.destroy()
    worker.close()
    await worker.closed
  }
  Pear.teardown(() => close())

  const debouncedRestart = debounceify(async () => {
    console.log(`Detected update and debounced for ${delayUpdate}ms before restarting`)
    await new Promise(resolve => setTimeout(resolve, delayUpdate)) // wait for the final update
    if (DEV && !hasUpdateDev(watchPrefixes, diff)) return
    if (!DEV && workerVersion === `${fork}.${length}`) return

    console.log(`Updating worker from ${workerVersion} to ${fork}.${length}`)
    await worker.ready
    console.log('Closing old worker')
    worker.close()
    await worker.closed
    console.log('Starting new worker')
    worker = start()
    await worker.ready
    workerVersion = await worker.version
  })

  updates = Pear.updates((update) => {
    diff = update.diff || []
    fork = update.version.fork
    length = update.version.length
    debouncedRestart()
  })

  if (pipe) {
    pipe.on('data', (data) => {
      const lines = data.toString().split('\n')
      for (let msg of lines) {
        msg = msg.trim()
        if (!msg) continue

        worker.write(msg)
      }
    })
    pipe.on('error', (err) => {
      console.log('Parent error', err)
      close()
    })
    pipe.on('close', () => {
      console.log('Parent closed')
      close()
    })
  }
}

/**
 * @type {function(string, OnData, OnError): {
 *   ready: Promise<boolean>,
 *   closed: Promise<boolean>,
 *   version: Promise<string>,
 *   write: Write,
 *   close: Close
 * }}
 */
function startWorker (runLink, onData, onError) {
  const readyPr = rrp()
  const closedPr = rrp()
  const versionPr = rrp()

  const pipe = Pear.worker.run(runLink, Pear.config.args)
  pipe.on('data', (data) => {
    const lines = data.toString().split('\n')
    for (let msg of lines) {
      msg = msg.trim()
      if (!msg) continue
      const obj = parseMsg(msg)

      if (obj.tag === 'ready') {
        console.log('Worker ready')
        readyPr.resolve()
      } else if (obj.tag === 'version') {
        console.log('Worker version', obj.data)
        versionPr.resolve(obj.data)
      } else if (obj.tag === 'error') {
        console.log('Worker error', obj.data)
        onError(obj.data)
      } else if (obj.tag === 'data') {
        onData(obj.data)
      } else {
        console.log('Worker unknown message', obj)
      }
    }
  })
  pipe.on('error', (err) => {
    console.log('Worker error', err)
    onError(`${err?.stack || err}`)
  })
  pipe.on('close', () => {
    console.log('Worker closed')
    readyPr.resolve()
    closedPr.resolve()
  })

  return {
    ready: readyPr.promise,
    closed: closedPr.promise,
    version: versionPr.promise,
    write: (data) => pipe.write(JSON.stringify({ tag: 'data', data }) + '\n'),
    close: () => pipe.write(JSON.stringify({ tag: 'close' }) + '\n')
  }
}

/** @type {function(string, number, number): string} **/
function getLink (botPath, fork, length) {
  if (DEV) return botPath // dev mode

  const url = new URL(botPath, `${Pear.config.applink}/`)
  url.host = `${fork}.${length}.${url.host}`
  return url.href
}

/** @type {function(string[], { key: string }[]): boolean} **/
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

/**
 * @type {function(
 *  function(string[], { write: Write }): Promise<{ write?: Write, close?: Close }>
 * ): Promise<void>}
 */
async function run (botRunner) {
  const pipe = Pear.worker.pipe()

  if (pipe) {
    process.on('uncaughtException', onError)
    process.on('unhandledRejection', onError)
    function onError (err) {
      pipe.write(JSON.stringify({ tag: 'error', data: `${err?.stack || err}` }) + '\n')
      pipe.end()
    }
  }

  const runner = await botRunner(
    Pear.config.args,
    {
      write: (data) => pipe?.write(JSON.stringify({ tag: 'data', data }) + '\n')
    }
  )

  if (!pipe) return

  pipe.on('data', async (data) => {
    const lines = data.toString().split('\n')
    for (let msg of lines) {
      msg = msg.trim()
      if (!msg) continue
      const obj = parseMsg(msg)

      if (obj.tag === 'data') {
        if (typeof runner?.write === 'function') {
          await runner.write(obj.data)
        } else {
          console.log('Missing write function')
        }
      } else if (obj.tag === 'close') {
        if (typeof runner?.close === 'function') {
          await runner.close().catch(console.log)
        } else {
          console.log('Missing close function')
        }
        pipe.end()
      } else {
        console.log('Unknown message', obj)
      }
    }
  })
  pipe.on('error', () => {
    if (typeof runner?.close === 'function') runner.close()
  })
  pipe.on('close', () => {
    if (typeof runner?.close === 'function') runner.close()
  })
  pipe.write(JSON.stringify({ tag: 'version', data: `${Pear.config.fork}.${Pear.config.length}` }) + '\n')
  pipe.write(JSON.stringify({ tag: 'ready' }) + '\n')
}

function parseMsg (msg) {
  try {
    return JSON.parse(msg)
  } catch {
    return { tag: 'unknown', data: msg }
  }
}

module.exports = { main, run }
