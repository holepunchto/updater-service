const botService = require('../../../index')

botService.run(() => {
  throw new Error('I am bot with error')
})
