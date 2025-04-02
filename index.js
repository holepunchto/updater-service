/* global Pear */

const debounceify = require('debounceify')

const isDev = Pear.config.key === null

function main (botPath) {
  const runLink = isDev ? botPath : new URL(botPath, `${Pear.config.applink}/`).href

  let worker = runWorker(runLink)

  Pear.updates(debounceify(async () => {
    await worker.ready
    await worker.close()
    worker = runWorker(runLink)
    await worker.ready
  }))
}

function run (botHandler) {
  const bot = botHandler(Pear.config.args)
  const pipe = Pear.worker.pipe()
  if (pipe) {
    bot.then(() => pipe.write('ready'))
    pipe.on('end', () => bot.then(({ close }) => close()))
  }
}

function runWorker (runLink) {
  const pipe = Pear.worker.run(runLink, Pear.config.args)
  const ready = new Promise((resolve) => {
    pipe.on('data', (data) => data.toString() === 'ready' && resolve())
  })
  const close = () => new Promise((resolve) => {
    pipe.on('close', resolve)
    pipe.end()
  })
  return { ready, close }
}

module.exports = { main, run }
