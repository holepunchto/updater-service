const updaterService = require('../../../index')

updaterService.run(() => {
  throw new Error('I am runner with error')
})
