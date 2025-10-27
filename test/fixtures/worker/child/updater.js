const path = require('path')
const updaterService = require('../../../../index')

updaterService.main(path.join('.', __dirname, 'runner.js'), {
  delayUpdate: 1000
})
