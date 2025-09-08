const path = require('path')
const botService = require('../../../index')

botService.main(path.join('.', __dirname, 'bot.js'), {
  delayUpdate: 1000
})
