const webpackConfig = require('./webpack.config.js')
webpackConfig.entry = {}

module.exports = function(config) {
  config.set({
    basePath: '',

    frameworks: ['mocha', 'sinon-chai'],

    client: {
      chai: {
        includeStack: true
      }
    },

    files: [
      'dist/solid-auth-oidc.min.js',
      'test/unit/*-test.js'
    ],

    preprocessors: {
      // 'dist/solid-auth-oidc.min.js': ['webpack'],
      './tests/**/*-test.js': ['babel']
    },

    babelPreprocessor: {
      options: {
        presets: [ 'es2015' ],
        sourceMap: 'inline'
      }
    },

    port: 9876,

    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['progress'],

    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: ['Chrome'],

    colors: true,

    webpack: webpackConfig,

    singleRun: true
  })
}
