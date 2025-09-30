![CI](https://github.com/holepunchto/bot-service/actions/workflows/ci.yml/badge.svg)
![Release](https://github.com/holepunchto/bot-service/actions/workflows/release.yml/badge.svg)
![Bump Deps](https://github.com/holepunchto/bot-service/actions/workflows/bump-deps.yml/badge.svg)

# Bot Service
- Run bot as a pear app (via pear-run)
- Auto restart bot on update (via pear-updates)

## Sample bot
- create `main.js` as the main entry point, then run `botService.main(<path-to-bot>)`
- create `index.js`, then implement the bot runner inside `botService.run(<bot-runner>)`
  - `bot-runner` receives params `args`
  - `bot-runner` should return a `close` function to teardown the bot 


```js
// main.js
const botService = require('@holepunchto/bot-service')
botService.main('index.js')

// index.js
const botService = require('@holepunchto/bot-service')
botService.run(async (args) => {
  // bot runner goes here
  const interval = setInterval(() => {
    console.log('I am bot', args)
  }, 1000)
  return { 
    // return 'close' function to teardown bot
    close: () => clearInterval(interval)
  }
})
```
