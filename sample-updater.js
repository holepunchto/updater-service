const updaterService = require('.')
updaterService.main('sample-runner.js', {
  delayUpdate: 1000, // default to a random number between 5-10s
  watchPrefixes: ['/sample-runner'] // default to ['/src']
})
