/* global Pear */
const botService = require('../../../../index')

botService.run(async (args, opts) => {
  const interval = setInterval(() => {
    opts.write('I am bot')
  }, 1000)
  Pear.teardown(() => clearInterval(interval))
  return {
    write: () => {
      clearInterval(interval)
      throw new Error('Test error to close child')
    },
    close: () => clearInterval(interval)
  }
})
