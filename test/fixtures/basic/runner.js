/* global Pear */
const updaterService = require('../../../index')

updaterService.run(async (args) => {
  const interval = setInterval(() => {
    console.log('I am runner', args)
  }, 1000)
  Pear.teardown(() => clearInterval(interval))
  return {
    close: () => clearInterval(interval)
  }
})
