/* global Pear */
const botService = require('../../../index')

botService.run(async (args) => {
  const interval = setInterval(() => {
    console.log('I am bot', args)
  }, 1000)
  Pear.teardown(() => clearInterval(interval))
  return {
    close: () => clearInterval(interval)
  }
})
