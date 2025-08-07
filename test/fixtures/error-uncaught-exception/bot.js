/* global Pear */
const botService = require('../../../index')

botService.run(async (args) => {
  const timeout = setTimeout(() => {
    throw new Error('This is an uncaught exception')
  }, 1000)
  Pear.teardown(() => clearTimeout(timeout))
  return {
    close: () => clearTimeout(timeout)
  }
})
