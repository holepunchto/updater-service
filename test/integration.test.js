const test = require('brittle')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

test('basic - direct run', async t => {
  const file = path.join(__dirname, 'fixtures', 'basic', 'bot.js')
  const child = spawn('pear', ['run', file, 'hello', 'world'])
  t.teardown(() => child.kill('SIGKILL'))

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
  t.teardown(() => child.kill('SIGKILL'))

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

test('error', async t => {
  const file = path.join(__dirname, 'fixtures', 'error', 'main.js')
  const child = spawn('pear', ['run', file])
  t.teardown(() => child.kill('SIGKILL'))

  const prError = promiseWithResolvers()
  const prClose = promiseWithResolvers()

  streamProcess(child, (data) => {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.includes('Worker error')) prError.resolve(line)
      if (line.startsWith('Worker closed')) prClose.resolve()
    }
  })
  const err = await prError.promise
  t.ok(err.includes('I am bot with error'), 'error message is correct')
  await prClose.promise
})

test('error - uncaught exception', async t => {
  const file = path.join(__dirname, 'fixtures', 'error-uncaught-exception', 'main.js')
  const child = spawn('pear', ['run', file])
  t.teardown(() => child.kill('SIGKILL'))

  const prError = promiseWithResolvers()
  const prClose = promiseWithResolvers()

  streamProcess(child, (data) => {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.includes('Worker error')) prError.resolve(line)
      if (line.startsWith('Worker closed')) prClose.resolve()
    }
  })
  const err = await prError.promise
  t.ok(err.includes('This is an uncaught exception'), 'error message is correct')
  await prClose.promise
})

test('update', async t => {
  const stage1 = await pearStage(t, '.')
  t.ok(stage1.data.key, 'stage1 done')
  const version = `${stage1.data.release}.${stage1.data.version}`
  const killSeeder = await pearSeed(t, stage1.data.key)

  const child = spawn('pear', ['run', `pear://${stage1.data.key}/test/fixtures/basic/main.js`])
  t.teardown(() => child.kill('SIGKILL'))

  const prReady = promiseWithResolvers()
  const prUpdate = promiseWithResolvers()
  const prClosingOldWorker = promiseWithResolvers()
  const prClosedOldWorker = promiseWithResolvers()
  const prClose = promiseWithResolvers()
  const prStartingNewWorker = promiseWithResolvers()

  let readyMsg = ''

  streamProcess(child, (data) => {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.includes('Worker data') && line.includes('ready')) {
        readyMsg = line
        prReady.resolve(line)
      }
      if (line.includes(`Updating worker from ${version} to`)) prUpdate.resolve(line)
      if (line.includes('Closing old worker')) prClosingOldWorker.resolve(line)
      if (line.includes('Bot data') && line.includes('close')) prClosedOldWorker.resolve(line)
      if (line.startsWith('Worker closed')) prClose.resolve(line)
      if (line.includes('Starting new worker')) prStartingNewWorker.resolve(line)
    }
  })

  await prReady.promise

  await fs.promises.writeFile(path.join(__dirname, 'tmp', 'foo.js'), `console.log(${Date.now()})`, 'utf-8')
  const stage2 = await pearStage(t, '.')
  t.is(stage2.data.key, stage1.data.key, 'stage2 done')
  const newVersion = `${stage2.data.release}.${stage2.data.version}`

  await prUpdate.promise
  await prClosingOldWorker.promise
  await prClosedOldWorker.promise
  await prClose.promise
  await prStartingNewWorker.promise

  await new Promise((resolve) => {
    const interval = setInterval(() => {
      if (readyMsg.includes(newVersion)) {
        clearInterval(interval)
        resolve()
      }
    }, 100)
  })
  t.ok(readyMsg.includes(newVersion), 'worker updated to new version')

  await new Promise((resolve) => setTimeout(resolve, 1000))
  child.kill()
  killSeeder()
})

async function pearStage (t, dir) {
  const params = ['stage', '--json', 'test', dir]
  const child = spawn('pear', params)
  t.teardown(() => child.kill('SIGKILL'))
  return untilTag(child, 'addendum')
}

async function pearSeed (t, key) {
  const child = spawn('pear', ['seed', '--json', `pear://${key}`])
  t.teardown(() => child.kill('SIGKILL'))
  await untilTag(child, 'announced')
  return () => child.kill('SIGKILL')
}

async function untilTag (child, tag, timeout = 600_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${tag}`))
    }, timeout)
    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n')
      lines.forEach((line) => {
        try {
          line = line.trim()
          if (!line) return
          const obj = JSON.parse(line)
          if (obj.tag === tag) {
            clearTimeout(timer)
            resolve(obj)
          }
        } catch (err) {
          console.log(err, line)
        }
      })
    })
  })
}

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
