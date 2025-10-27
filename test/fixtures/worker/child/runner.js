/* global Pear */
const updaterService = require('../../../../index')

updaterService.run(async (args, opts) => {
  const interval = setInterval(() => {
    opts.write('I am runner')
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
