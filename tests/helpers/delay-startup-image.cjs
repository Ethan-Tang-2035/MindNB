// Keep the actual document load pending after the home screen renders.
const { net } = require('electron')
const fetch = net.fetch.bind(net)
net.fetch = async (input, ...args) => {
  if (String(input).includes('/brand/icon-128.png')) {
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  return fetch(input, ...args)
}
