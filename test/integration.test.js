const test = require('brittle')
const rrp = require('resolve-reject-promise')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

test('basic - direct run', async t => {
  const file = path.join(__dirname, 'fixtures', 'basic', 'bot.js')
  const child = spawn('pear', ['run', file, 'hello', 'world'])
  t.teardown(() => child.kill('SIGKILL'))

  const pr = rrp()
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

  const prWorker = rrp()
  const prBot = rrp()
  const prClose = rrp()

  streamProcess(child, (data) => {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.startsWith('Worker version')) prWorker.resolve(line)
      if (line.startsWith('I am bot')) prBot.resolve(line)
      if (line.startsWith('Worker closed')) prClose.resolve()
    }
  })
  const resWorker = await prWorker.promise
  const resBot = await prBot.promise
  child.kill()

  t.is(resWorker, 'Worker version 0.0', 'worker output is correct')
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

  const prError = rrp()
  const prClose = rrp()

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

  const prError = rrp()
  const prClose = rrp()

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
  t.timeout(120_000)

  const channel = `update-${Date.now()}`
  const stage1 = await pearStage(t, channel, '.')
  t.ok(stage1.data.key, 'stage1 done')
  const version = `${stage1.data.release}.${stage1.data.version}`

  const child = spawn('pear', ['run', `pear://${stage1.data.key}/test/fixtures/basic/main.js`])
  t.teardown(() => child.kill('SIGKILL'))

  let versionMsg = ''
  const prReady = rrp()
  const prUpdate = rrp()
  const prClosingWorker = rrp()
  const prClosedWorker = rrp()
  const prStartingNewWorker = rrp()

  streamProcess(child, (data) => {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.includes('Worker version')) versionMsg = line
      if (line.includes('Worker ready')) prReady.resolve(line)
      if (line.includes(`Updating worker from ${version} to`)) prUpdate.resolve(line)
      if (line.includes('Closing old worker')) prClosingWorker.resolve(line)
      if (line.includes('Worker closed')) prClosedWorker.resolve(line)
      if (line.includes('Starting new worker')) prStartingNewWorker.resolve(line)
    }
  })

  await prReady.promise
  t.is(versionMsg, `Worker version ${version}`, `worker started on version ${version}`)

  await fs.promises.writeFile(path.join(__dirname, 'tmp', 'foo.js'), `console.log(${Date.now()})`, 'utf-8')
  const stage2 = await pearStage(t, channel, '.')
  t.is(stage2.data.key, stage1.data.key, 'stage2 done')
  const newVersion = `${stage2.data.release}.${stage2.data.version}`

  await prUpdate.promise
  await prClosingWorker.promise
  await prClosedWorker.promise
  await prStartingNewWorker.promise

  await new Promise((resolve) => {
    const interval = setInterval(() => {
      if (versionMsg.includes(newVersion)) {
        clearInterval(interval)
        resolve()
      }
    }, 100)
  })
  t.is(versionMsg, `Worker version ${newVersion}`, `worker updated to new version ${newVersion}`)

  child.kill()
})

test('user app starts bot-service in a worker', async t => {
  const channel = `update-${Date.now()}`

  const parentDir = path.join(__dirname, 'fixtures', 'worker', 'parent')

  const stageParent = await pearStage(t, channel, parentDir)
  t.ok(stageParent.data.key, 'stageParent done')
  const stageChild = await pearStage(t, channel, '.')
  t.ok(stageChild.data.key, 'stageChild done')

  const child = spawn('pear', ['run', `pear://${stageParent.data.key}`, stageChild.data.key])
  t.teardown(() => child.kill('SIGKILL'))

  const prData = rrp()
  const prError = rrp()
  const prClose = rrp()

  streamProcess(child, (data) => {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.includes('I am bot')) prData.resolve()
      if (line.includes('Test parent error')) prError.resolve(line)
      if (line.includes('Test parent closed')) prClose.resolve()
    }
  })

  await prData.promise
  await prError.promise
  await prClose.promise

  child.kill()
})

async function pearStage (t, channel, dir) {
  const params = ['stage', '--json', channel, dir]
  const child = spawn('pear', params)
  t.teardown(() => child.kill('SIGKILL'))
  return untilTag(child, 'addendum')
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
