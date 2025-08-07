const test = require('brittle')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const tmpDir = require('test-tmp')
const goodbye = require('graceful-goodbye')

test('basic - direct run', async t => {
  const file = path.join(__dirname, 'fixtures', 'basic', 'bot.js')
  const child = spawn('pear', ['run', file, 'hello', 'world'])
  goodbye(() => child.kill('SIGKILL'))

  const pr = promiseWithResolvers()
  streamProcess(child, (data) => {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.startsWith('I am bot')) pr.resolve(line)
    }
  })
  const res = await pr.promise
  child.kill()
  t.ok(res.startsWith('I am bot'), 'output is correct')
  const args = res.match(/\[(.*?)\]/)[1].split(',').map(arg => arg.trim().replace(/'/g, ''))
  t.is(args[0], 'hello', 'args[0] is correct')
  t.is(args[1], 'world', 'args[1] is correct')
})

test('basic - start main', async t => {
  const file = path.join(__dirname, 'fixtures', 'basic', 'main.js')
  const child = spawn('pear', ['run', file, 'hello', 'world'])
  goodbye(() => child.kill('SIGKILL'))

  const prWorker = promiseWithResolvers()
  const prBot = promiseWithResolvers()
  const prClose = promiseWithResolvers()

  streamProcess(child, (data) => {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.startsWith('Worker data')) prWorker.resolve(line)
      if (line.startsWith('I am bot')) prBot.resolve(line)
      if (line.startsWith('Worker closed')) prClose.resolve()
    }
  })
  const resWorker = await prWorker.promise
  const resBot = await prBot.promise
  child.kill()

  t.ok(resWorker.startsWith('Worker data'), 'worker output is correct')
  const workerData = JSON.parse(resWorker.match(/\[(.*)\]/)[0].replace(/"/g, '\\"').replace(/'/g, '"'))
    .filter(item => item.trim()).map((item) => JSON.parse(item))
  t.is(workerData.length, 2, 'worker data length is correct')
  t.is(workerData[0].tag, 'version', 'workerData[0].tag is correct')
  t.is(workerData[0].data, '0.0', 'workerData[0].data is correct')
  t.is(workerData[1].tag, 'ready', 'workerData[1].tag is correct')

  t.ok(resBot.startsWith('I am bot'), 'bot output is correct')
  const args = resBot.match(/\[(.*?)\]/)[1].split(',').map(arg => arg.trim().replace(/'/g, ''))
  t.is(args[0], 'hello', 'bot args[0] is correct')
  t.is(args[1], 'world', 'bot args[1] is correct')

  await prClose.promise
})

// async function untilExit (child, code) {
//   return new Promise((resolve, reject) => {
//     child.on('exit', (out) => +out === code ? resolve() : reject(new Error(out)))
//   })
// }

function streamProcess (proc, write) {
  proc.stderr.on('data', (data) => write(data.toString()))
  proc.stdout.on('data', (data) => write(data.toString()))
  proc.on('error', (err) => write(`${err}`))
  proc.on('exit', (code) => {
    if (+code) write(`Exit with code ${code}`)
  })
}

function promiseWithResolvers () {
  const resolvers = {}
  const promise = new Promise((resolve, reject) => {
    resolvers.resolve = resolve
    resolvers.reject = reject
  })
  return { promise, ...resolvers }
}
