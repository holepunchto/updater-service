import BotService from '../../../index'

BotService.run(() => {
  throw new Error('I am bot with error')
})
