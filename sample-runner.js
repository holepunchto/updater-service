const updaterService = require('.')
updaterService.run(myApp)

async function myApp (args) {
  const interval = setInterval(() => {
    console.log('I am app', args)
  }, 1000)
  return {
    // return 'close' function to restart app
    close: () => clearInterval(interval)
  }
}
