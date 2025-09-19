import path from 'path'
import BotService from '../../../index'

const dirname = path.join('.', import.meta.url.substring('pear://dev'.length), '..')

BotService.main(path.join(dirname, 'bot.js'))
