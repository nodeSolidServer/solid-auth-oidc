/*
 The MIT License (MIT)

 Copyright (c) 2016-17 Solid

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

// URI parameter types
const HASH = 'hash'
const QUERY = 'query'

// AuthenticationRequest sending methods
const REDIRECT = 'redirect'

class ClientAuthOIDC {
  /**
   * @constructor
   * @param [options={}]
   * @param [options.window=Window] Optionally inject global browser window
   * @param [options.localStorage=localStorage] Optionally inject localStorage
   */
  constructor (options = {}) {
    this.window = options.window || window
    this.localStorage = options.localStorage || localStorage
    this.currentClient = null
    this.providerUri = null
    this.webId = null
    this.idToken = null
    this.accessToken = null
    this.method = REDIRECT  // only redirect is currently supported
  }

  initEventListeners (window) {
    window.addEventListener('message', this.onMessage.bind(this))
  }

  /**
   * Returns the current window's URI
   * @return {string}
   */
  currentLocation () {
    let window = this.window
    return window.location.href
  }

  /**
   * Extracts and returns the `state` query or hash fragment param from a uri
   * @param uri {string}
   * @param uriType {string} 'hash' or QUERY
   * @return {string|null} Value of the `state` query or hash fragment param
   */
  extractState (uri, uriType = HASH) {
    if (!uri) { return null }
    let uriObj = new URL(uri)
    let state
    if (uriType === HASH) {
      let hash = uriObj.hash || '#'
      let params = new URLSearchParams(hash.substr(1))
      state = params.get('state')
    }
    if (uriType === QUERY) {
      state = uriObj.searchParams.get('state')
    }
    return state
  }

  keyByProvider (providerUri = this.providerUri) {
    return `oidc.rp.by-provider.${providerUri}`
  }

  keyByState (state) {
    if (!state) {
      throw new TypeError('No state provided to keyByState()')
    }
    return `oidc.rp.by-state.${state}`
  }

  /**
   * @param providerUri {string}
   * @return {Promise<RelyingParty>}
   */
  loadOrRegisterClient (providerUri) {
    return this.loadClient(providerUri)
      .then(loadedClient => {
        if (loadedClient) {
          return loadedClient
        } else {
          return this.registerClient(providerUri)
        }
      })
  }

  /**
   * @param providerUri {string}
   * @return {Promise<RelyingParty>}
   */
  loadClient (providerUri) {
    if (!providerUri) {
      let error = new Error('Cannot load or register client, providerURI missing')
      return Promise.reject(error)
    }
    if (this.currentClient && this.currentClient.provider.url === providerUri) {
      // Client is cached, return it
      return Promise.resolve(this.currentClient)
    }

    // Check for client config stored locally
    let key = this.keyByProvider(providerUri)
    let clientConfig = localStorage.getItem(key)
    if (clientConfig) {
      clientConfig = JSON.parse(clientConfig)
      return RelyingParty.from(clientConfig)
    } else {
      return Promise.resolve(null)
    }
  }

  /**
   * Loads a provider's URI from localStorage, given a `state` uri param.
   * @param state {string}
   * @return {string}
   */
  loadProvider (state) {
    let key = this.keyByState(state)
    let providerUri = localStorage.getItem(key)
    return providerUri
  }

  /**
   * Resolves to the WebID URI of the current user. Intended to be called
   * on page load (in case the user is already authenticated), as well as
   * triggered when the user initiates login explicitly (such as by pressing
   * a Login button, etc).
   * @param [providerUri] {string} Provider URI, result of a Provider Selection
   *   operation (that the app developer has provided). If `null`, the
   *   `selectProvider()` step will kick off its own UI for Provider Selection.
   * @return {Promise<string>} Resolves to the logged in user's WebID URI
   */
  login (providerUri) {
    let selectProvider = this.selectProvider.bind(this)
    let loadOrRegisterClient = this.loadOrRegisterClient.bind(this)
    let validateOrSendAuthRequest = this.validateOrSendAuthRequest.bind(this)

    return Promise.resolve(providerUri)
      .then(selectProvider)
      .then(loadOrRegisterClient)
      .then(validateOrSendAuthRequest)
  }

  /**
   * Resolves to the URI of an OIDC identity provider, from one of the following:
   *
   * 1. If a `providerUri` was passed in by the app developer (perhaps they
   *   developed a custom 'Select Provider' UI), that value is returned.
   * 2. The current `this.providerUri` cached on this auth client, if present
   * 3. The `state` parameter of the current window URI (in case the user has
   *   gone through the login workflow and this page is the redirect back).
   * 3. Lastly, if none of the above worked, the clients opens its own
   *   'Select Provider' UI popup window, and sets up an event listener (for
   *   when a user makes a selection.
   *
   * @param [providerUri] {string} If the provider URI is already known to the
   *   app developer, just pass it through, no need to take further action.
   * @return {Promise<string>}
   */
  selectProvider (providerUri) {
    if (providerUri) {
      return Promise.resolve(providerUri)
    }
    // Attempt to find a provider based on the 'state' param of the current URI
    providerUri = this.providerFromCurrentUri()
    if (providerUri) {
      return Promise.resolve(providerUri)
    }
    // Lastly, kick off a Select Provider popup window workflow
    return this.providerFromUI()
  }

  /**
   * Parses the current URI's `state` hash param and attempts to load a
   * previously saved providerUri from it. If no `state` param is present, or if
   * no providerUri has been saved, returns `null`.
   *
   * @return {string|null} Provider URI, if present
   */
  providerFromCurrentUri () {
    let currentUri = this.currentLocation()
    let stateParam = this.extractState(currentUri, HASH)
    if (stateParam) {
      return this.loadProvider(stateParam)
    } else {
      return null
    }
  }

  providerFromUI () {
    console.log('No state param, getting provider from UI')
    this.initEventListeners(window)
    // Get the provider from the UI somehow
  }

  /**
   * Tests whether the current URI is the result of an AuthenticationRequest
   * return redirect.
   * @return {boolean}
   */
  currentUriHasAuthResponse () {
    let currentUri = this.currentLocation()
    let stateParam = this.extractState(currentUri, HASH)
    return !!stateParam
  }

  /**
   * Redirects the current window to the given uri.
   * @param uri {string}
   */
  redirectTo (uri) {
    this.window.location = uri
  }

  /**
   * @private
   * @param client {RelyingParty}
   * @throws {Error}
   * @return {Promise<null>}
   */
  sendAuthRequest (client) {
    let options = {}
    let providerUri = client.provider.url
    return client.createRequest(options, this.localStorage)
      .then(authUri => {
        let state = this.extractState(authUri, QUERY)
        if (!state) {
          throw new Error('Invalid authentication request uri')
        }
        this.saveProviderByState(state, providerUri)
        if (this.method === REDIRECT) {
          this.redirectTo(authUri)
        }
      })
  }

  /**
   * @param client {RelyingParty}
   * @throws {Error}
   * @return {Promise<null|string>} Resolves to either an AuthenticationRequest
   *   being sent (`null`), or to the webId of the current user (extracted
   *   from the authentication response).
   */
  validateOrSendAuthRequest (client) {
    if (!client) {
      let error = new Error('Could not load or register a RelyingParty client')
      return Promise.reject(error)
    }

    if (this.currentUriHasAuthResponse()) {
      return this.initUserFromResponse(client)
    }

    return this.sendAuthRequest(client)
  }

  /**
   * Validates the auth response in the current uri, initializes the current
   * user's ID Token and Access token, and returns the
   * @param client {RelyingParty}
   * @throws {Error}
   * @returns {Promise<string>}
   */
  initUserFromResponse (client) {
    return client.validateResponse(this.currentLocation(), this.localStorage)
      .then(response => {
        this.idToken = response.params.id_token
        this.accessToken = response.params.access_token
        return this.extractAndValidateWebId(response.decoded)
      })
      .catch(error => {
        if (error.message === 'Cannot resolve signing key for ID Token.') {
          console.log('ID Token found, but could not validate. Provider likely has changed their public keys. Please retry login.')
          return null
        } else {
          throw error
        }
      })
  }

  /**
   * @param idToken {IDToken}
   * @throws {Error}
   * @return {string}
   */
  extractAndValidateWebId (idToken) {
    let webId = idToken.payload.sub
    return webId
  }

  /**
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
      .then(registeredClient => {
        this.storeClient(registeredClient, providerUri)
        return registeredClient
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
    let redirectUri = options.redirectUri || this.currentLocation()
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
        console.log('Provider selected: ', event.data.value)
        break
      default:
        console.error('onMessage - unknown event type: ', event)
        break
    }
  }

  /**
   * @param state {string}
   * @param providerUri {string}
   * @throws {Error}
   */
  saveProviderByState (state, providerUri) {
    if (!state) {
      throw new Error('Cannot save providerUri - state not provided')
    }
    let key = this.keyByState(state)
    localStorage.setItem(key, providerUri)
  }

  /**
   * Stores a RelyingParty client for a given provider in localStorage.
   * @param client {RelyingParty}
   * @param providerUri {string}
   */
  storeClient (client, providerUri) {
    this.currentClient = client
    localStorage.setItem(this.keyByProvider(providerUri), client.serialize())
  }
}

module.exports = ClientAuthOIDC

