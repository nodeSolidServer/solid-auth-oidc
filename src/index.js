/*
 The MIT License (MIT)

 Copyright (c) 2016 Solid

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.

 If you would like to know more about the solid Solid project, please see
 https://github.com/solid/solid
 */
'use strict'
const RelyingParty = require('oidc-rp')

class ClientAuthOIDC {
  constructor () {
    this.accessToken = null
    this.currentClient = null
    this.providerUri = null
    this.webId = null
    this.defaultCallbacks = {
      onLoginSuccess: (webId, accessToken) => {
        console.log('onLoginSuccess() callback! webId: ', webId,
          'access_token: ', accessToken)
      },
      onProviderSelected: (providerUri) => {
        console.log('onProviderSelected() callback! providerUri: ', providerUri)
      }
    }
    this.callbacks = {}
  }

  detectAuthCallback () {
    let currentUri = window.location.href
    let state = this.extractState(currentUri, 'hash')
    if (!state) { return }
    console.log('Auth callback detected. Loading provider by state: ', state)
    let providerUri = this.loadProvider(state)
    if (!providerUri) {
      console.error('Auth callback detected, but no provider stored for state!')
      return
    }
    console.log('Provider loaded from state: ', providerUri, '. Loading client.')
    this.dispatchProviderSelected(providerUri)
    return this.loadOrRegisterClient(providerUri)
      .then(client => {
        if (!client) { return }
        console.log('Loaded client: ', client.registration.client_id)
        console.log('Validating auth response...')
        return client.validateResponse(currentUri, localStorage)
      })
      .then(response => {
        console.log('Validated auth response: ', response)
        let webId = response.decoded.payload.sub
        let accessToken = response.params.access_token
        return this.dispatchLoginSuccess(webId, accessToken)
      })
  }

  dispatchLoginSuccess (webId, accessToken) {
    this.webId = webId
    this.accessToken = accessToken
    let callback = this.callbacks.onLoginSuccess ||
      this.defaultCallbacks.onLoginSuccess
    if (callback) {
      callback.bind(this)
      callback(webId, accessToken)
    } else {
      throw new Error('onLoginSuccess() callback not found')
    }
  }

  dispatchProviderSelected (providerUri) {
    this.providerUri = providerUri
    let callback = this.callbacks.onProviderSelected ||
      this.defaultCallbacks.onProviderSelected
    if (callback) {
      callback.bind(this)
      callback(providerUri)
    } else {
      throw new Error('onProviderSelected() callback not found')
    }
  }

  /**
   * Extracts and returns the `state` query or hash fragment param from a uri
   * @param uri {string}
   * @param uriType {string} 'hash' or 'query'
   * @return {string} Value of the `state` query or hash fragment param
   */
  extractState (uri, uriType = 'hash') {
    if (!uri) { return }
    let uriObj = new URL(uri)
    let state
    if (uriType === 'hash') {
      let hash = uriObj.hash || '#'
      let params = new URLSearchParams(hash.substr(1))
      state = params.get('state')
    }
    if (uriType === 'query') {
      state = uriObj.searchParams.get('state')
    }
    return state
  }

  init (callbacks = {}) {
    this.callbacks = callbacks
    window.addEventListener('message', this.onMessage.bind(this))
    this.detectAuthCallback()
  }

  keyByProvider (providerUri = this.providerUri) {
    return `oidc.rp.by-provider.${providerUri}`
  }

  keyByState (state) {
    return `oidc.rp.by-state.${state}`
  }

  /**
   * @param providerUri {string}
   * @return {Promise<RelyingParty>}
   */
  loadOrRegisterClient (providerUri) {
    if (this.currentClient) {
      console.log('currentClient cached, returning')
      return Promise.resolve(this.currentClient)
    }
    // Check for client config stored locally
    let key = this.keyByProvider(providerUri)
    let clientConfig = localStorage.getItem(key)
    if (clientConfig) {
      console.log('client config stored locally for ', providerUri)
      clientConfig = JSON.parse(clientConfig)
      return RelyingParty.from(clientConfig)
    } else {
      console.log('client config not stored, proceeding to register client')
      // Client not stored. Register it and store it
      return this.registerClient(providerUri)
        .then(client => {
          this.storeClient(client, providerUri)
          return client
        })
    }
  }

  loadProvider (state) {
    let key = this.keyByState(state)
    let providerUri = localStorage.getItem(key)
    return providerUri
  }

  /**
   * @param providerUri {string}
   * @param client {RelyingParty}
   * @param method {string} 'redirect' or 'popup'
   * @return {Promise} Creates auth request uri, stores state & nonce, and
   *   dispatches the auth request according to `method`.
   */
  login (providerUri, client, method = 'redirect') {
    if (!client) {
      throw new TypeError('Cannot login(), missing client')
    }
    return client.createRequest({}, localStorage)
      .then(authUri => {
        console.log('login()>createRequest()>url: ', authUri)
        let state = this.extractState(authUri, 'query')
        if (!state) {
          throw new Error('login() - could not extract state param')
        }
        this.saveProviderByState(providerUri, state)
        if (method === 'redirect') {
          window.location = authUri
        }
      })
  }

  /**
   * @private
   * @param providerUri {string}
   * @param [options={}]
   * @param [options.redirectUri] {string} Defaults to window.location.href
   * @param [options.scope='openid profile'] {string}
   * @param [options.store=localStorage]
   * @throws {TypeError} If providerUri is missing
   * @return {Promise<RelyingParty>} Registered RelyingParty client instance
   */
  registerClient (providerUri, options = {}) {
    return this.registerPublicClient(providerUri, options)
      .catch(error => {
        console.error('Error while registering:', error)
      })
  }

  /**
   * @private
   * @param providerUri {string}
   * @param [options={}]
   * @param [options.redirectUri] {string} Defaults to window.location.href
   * @param [options.scope='openid profile'] {string}
   * @param [options.store=localStorage]
   * @throws {TypeError} If providerUri is missing
   * @return {Promise<RelyingParty>} Registered RelyingParty client instance
   */
  registerPublicClient (providerUri, options = {}) {
    console.log('Registering public client...')
    if (!providerUri) {
      throw new TypeError('Cannot registerClient auth client, missing providerUri')
    }
    let redirectUri = options.redirectUri || window.location.href
    this.redirectUri = redirectUri
    let registration = {
      issuer: providerUri,
      grant_types: ['implicit'],
      redirect_uris: [ redirectUri ],
      response_types: ['id_token token'],
      scope: options.scope || 'openid profile'
    }
    let rpOptions = {
      defaults: {
        authenticate: {
          redirect_uri: redirectUri,
          response_type: 'id_token token'
        }
      },
      store: options.store || localStorage
    }
    return RelyingParty
      .register(providerUri, registration, rpOptions)
  }

  onMessage (event) {
    console.log('Auth client received event: ', event)
    if (!event || !event.data) { return }
    switch (event.data.event_type) {
      case 'providerSelected':
        this.selectProvider(event.data.value)
        break
      default:
        console.error('onMessage - unknown event type: ', event)
        break
    }
  }

  saveProviderByState (providerUri, state) {
    let key = this.keyByState(state)
    localStorage.setItem(key, providerUri)
  }

  selectProvider (providerUri, loginMethod = 'redirect') {
    this.dispatchProviderSelected(providerUri)
    this.loadOrRegisterClient(providerUri)
      .then(client => {
        console.log('Obtained registered client. Proceeding to login().')
        return this.login(providerUri, client, loginMethod)
      })
  }

  storeClient (client, providerUri) {
    this.currentClient = client
    // this.clientId = currentClient.registration.client_id
    localStorage.setItem(this.keyByProvider(providerUri), client.serialize())
  }
}

module.exports = ClientAuthOIDC

