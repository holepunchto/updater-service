# Bot Service
- Run bot as a pear app (via Pear.worker)
- Auto restart bot on update (via Pear.updates)

## Sample bot
|-- index.js
|-- run.js
|-- package.json

```js
// index.js
const botService = require('bot-service')
botService.main('run.js')

// run.js
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
