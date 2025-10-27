/* global Pear */
const updaterService = require('../../../index')

updaterService.run(async (args) => {
  const timeout = setTimeout(() => {
    throw new Error('This is an uncaught exception')
  }, 1000)
  Pear.teardown(() => clearTimeout(timeout))
  return {
    close: () => clearTimeout(timeout)
  }
})
