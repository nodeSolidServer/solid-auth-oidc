var path = require('path')

module.exports = {
  entry: [
    './lib/index.js'
  ],
  output: {
    path: path.join(__dirname, '/dist/'),
    filename: 'solid-auth-oidc.min.js',
    library: 'SolidAuth',
    libraryTarget: 'var'
  },
  externals: {
    'node-fetch': 'fetch',
    'text-encoding': 'TextEncoder',
    'urlutils': 'URL',
    'webcrypto': 'crypto'
  },
  devtool: 'source-map'
}
