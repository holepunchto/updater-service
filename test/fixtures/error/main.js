/* global Pear */
import path from 'path'
import BotService from '../../../index'

const dirname = path.join(Pear.config.linkData, '..')

BotService.main(path.join(dirname, 'bot.js'))
