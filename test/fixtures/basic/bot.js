/* global Pear */
import BotService from '../../../index.js'

BotService.run(async (args) => {
  const interval = setInterval(() => {
    console.log('I am bot', args)
  }, 1000)
  Pear.teardown(() => clearInterval(interval))
  return {
    close: () => clearInterval(interval)
  }
})
