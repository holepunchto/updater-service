# Bot Service
- Run bot as a pear app (via Pear.worker)
- Auto restart bot on update (via Pear.updates)

## Sample bot
- create `index.js` as the main entry point, then run `botService.main(<path-to-bot>)`
- create `bot.js`, then implement the bot handler inside `botService.run(<bot-handler>)`
  - `bot-handler` receives params `args` and `opts`
  - `bot-handler` should return a `close` function to teardown the bot 


```js
// index.js
const botService = require('bot-service')
botService.main('bot.js')

// bot.js
const botService = require('bot-service')
botService.run(async (args) => {
  // bot handler goes here
  const interval = setInterval(() => {
    console.log('I am bot', args)
  }, 1000)
  return { 
    // return 'close' function to teardown bot
    close: () => clearInterval(interval)
  }
})
```
