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
const pearRun = require('pear-run')
const pearUpdates = require('pear-updates')
const pearPipe = require('pear-pipe')

const app = Pear.app || Pear.config // v1 compat
const IS_LOCAL = app.key === null
const IS_DEV = IS_LOCAL && app.dev === true
if (IS_LOCAL) console.log('LOCAL mode')
if (IS_DEV) console.log('DEV mode')

//
// main
//

/**
 * @type {function(string, {
 *   delayUpdate?: number,
 *   devWatchPrefixes?: string[],
 * }): void}
 */
function main (runnerPath, opts = {}) {
  const {
    delayUpdate = IS_DEV ? 1000 : (Math.floor(Math.random() * (30 - 10 + 1)) + 10) * 1000, // 10-30s
    devWatchPrefixes = ['/index.js']
  } = opts

  let onData = console.log
  let onError = console.log
  const pipe = pearPipe()
  if (pipe) {
    onData = (data) => pipe.write(JSON.stringify({ tag: 'data', data }) + '\n')
    onError = (data) => pipe.write(JSON.stringify({ tag: 'error', data }) + '\n')
  }

  let diff = []
  let fork = app.fork
  let length = app.length
  let workerVersion = `${fork}.${length}`
  let updates = null

  const start = () => startWorker(
    getLink(runnerPath, fork, length),
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
    console.log(`Detected update and debounced for ${delayUpdate}ms`)
    await new Promise(resolve => setTimeout(resolve, delayUpdate)) // wait for the final update
    if (IS_DEV && !hasDevUpdate(devWatchPrefixes, diff)) return
    if (!IS_DEV && workerVersion === `${fork}.${length}`) return

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

  updates = pearUpdates((update) => {
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
      console.log('Parent error:', err)
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

  const pipe = pearRun(runLink, app.args)
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
        console.log('Worker version:', obj.data)
        versionPr.resolve(obj.data)
      } else if (obj.tag === 'error') {
        console.log('Worker error:', obj.data)
        onError(obj.data)
      } else if (obj.tag === 'data') {
        onData(obj.data)
      } else {
        console.log('Worker unknown message:', obj)
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
function getLink (runnerPath, fork, length) {
  if (IS_LOCAL) return runnerPath

  const url = new URL(runnerPath, `${app.applink}/`)
  url.host = `${fork}.${length}.${url.host}`
  return url.href
}

/** @type {function(string[], { key: string }[]): boolean} **/
function hasDevUpdate (watchPrefixes, diff) {
  for (const { key } of diff) {
    console.log('Checking diff:', watchPrefixes, key)
    if (!key.endsWith('.js')) continue
    if (!watchPrefixes.some(prefix => key.startsWith(prefix))) continue
    console.log('Found diff:', key)
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
async function run (runnerFn) {
  const pipe = pearPipe()
  if (pipe) {
    process.on('uncaughtException', onError)
    process.on('unhandledRejection', onError)
    function onError (err) {
      pipe.write(JSON.stringify({ tag: 'error', data: `${err?.stack || err}` }) + '\n')
      pipe.end()
    }
  }

  const runner = await runnerFn(
    app.args,
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
          await runner.close()
        } else {
          console.log('Missing close function')
        }
        pipe.end()
      } else {
        console.log('Unknown message:', obj)
      }
    }
  })
  pipe.on('error', () => {
    if (typeof runner?.close === 'function') runner.close()
  })
  pipe.on('close', () => {
    if (typeof runner?.close === 'function') runner.close()
  })
  pipe.write(JSON.stringify({ tag: 'version', data: `${app.fork}.${app.length}` }) + '\n')
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
