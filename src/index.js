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
const providerSelectPopupSource = require('./provider-select-popup')

// URI parameter types
const HASH = 'hash'
const QUERY = 'query'

// AuthenticationRequest sending methods
const REDIRECT = 'redirect'

// Local storage keys
const CURRENT_PROVIDER = 'solid.current-provider'
const CURRENT_CREDENTIALS = 'solid.current-user'

// Local storage key prefixes
const RP_BY_PROVIDER = 'oidc.rp.by-provider.'
const PROVIDER_BY_STATE = 'oidc.provider.by-state.'

class ClientAuthOIDC {
  /**
   * @constructor
   * @param [options={}]
   * @param [options.window=Window] Optionally inject global browser window
   * @param [options.store=localStorage] Optionally inject localStorage
   * @param [options.providerUri] {string} Previously selected provider uri
   *   (typically loaded from storage)
   * @param [options.redirectUri] {string} This app's callback redirect uri,
   *   defaults to the current window's uri.
   * @param [options.debug] {Function}
   */
  constructor (options = {}) {
    this.window = options.window || global.window
    this.store = options.store || global.localStorage

    this.debug = options.debug || console.error.bind(console)

    this.currentClient = null
    this.providerUri = options.providerUri
    this.redirectUri = options.redirectUri
    this.webId = options.webId
    this.idToken = options.idToken
    this.accessToken = options.accessToken
    this.method = REDIRECT  // only redirect is currently supported
  }

  /**
   * Factory method, returns an auth client instance initialized with options
   * or defaults (including loading stored credentials and current provider
   * from local storage).
   *
   * @param options {Object} See constructor options
   * @param [options.store=localStorage] {Store}
   * @param [options.providerUri] {string}
   *
   * @returns {ClientAuthOIDC}
   */
  static from (options) {
    let store = options.store || global.localStorage
    let providerUri = options.providerUri || store.getItem(CURRENT_PROVIDER)

    let { webId, idToken, accessToken } = ClientAuthOIDC.loadCurrentCredentials(store)

    options = Object.assign({}, options, {
      store,
      providerUri,
      webId,
      idToken,
      accessToken
    })

    return new ClientAuthOIDC(options)
  }

  /**
   * Loads the saved user credentials from local storage.
   *
   * @static
   * @param store {Store}
   *
   * @returns {Object} Credentials hashmap
   */
  static loadCurrentCredentials (store) {
    let currentCredentials = store.getItem(CURRENT_CREDENTIALS)

    if (!currentCredentials) { return {} }

    return JSON.parse(currentCredentials)
  }

  /**
   * Loads the saved user credentials from local storage.
   *
   * @returns {Object} Credentials hashmap
   */
  loadCurrentCredentials () {
    let credentials = ClientAuthOIDC.loadCurrentCredentials(this.store)

    this.setCurrentCredentials(credentials)
  }

  /**
   * Sets up the onMessage window event listener (used by the Select Provider
   * popup).
   *
   * @param window {Window}
   */
  initEventListeners (window) {
    window.addEventListener('message', this.onMessage.bind(this))
  }

  /**
   * Returns the current window's URI
   *
   * @return {string|null}
   */
  currentLocation () {
    let window = this.window

    if (!window || !window.location) { return null }

    return window.location.href
  }

  /**
   * Returns the previously selected provider (cached on the object, saved in
   * localStorage, or loaded from the callback uri using a previously stored
   * state parameter).
   *
   * @return {string|null}
   */
  currentProvider () {
    return this.providerUri ||
      this.store.getItem(CURRENT_PROVIDER) ||
      this.providerFromCurrentUri()
  }

  /**
   * Saves the currently selected provider in storage.
   *
   * @param providerUri {string}
   */
  saveCurrentProvider (providerUri) {
    this.providerUri = providerUri

    this.store.setItem(CURRENT_PROVIDER, providerUri)
  }

  /**
   * Resolves with the currently logged in user's WebID URI.
   * Recommended to call this as soon as the page is loaded (or your framework
   * ready event fires).
   *
   * Attempts to load the logged in webid from storage, or from the callback
   * redirect uri (this is the part that requires an async operation).
   *
   * @return {Promise<string>} WebID URI
   */
  currentUser () {
    if (this.webId) {
      return Promise.resolve(this.webId)
    }

    this.loadCurrentCredentials()
    if (this.webId) {
      return Promise.resolve(this.webId)
    }

    // Attempt to find a provider based either the cached value
    // or on the 'state' param of the current URI
    let providerUri = this.currentProvider()

    if (providerUri) {
      return this.login(providerUri)
    } else {
      return Promise.resolve(null)
    }
  }

  /**
   * Returns the 'end session' api endpoint of the current RP client's provider
   * (e.g. 'https://example.com/logout'), if one is available.
   *
   * @return {string|null}
   */
  providerEndSessionEndpoint () {
    let rp = this.currentClient

    if (!rp || !rp.provider || !rp.provider.configuration) { return null }

    let config = rp.provider.configuration

    if (!config.end_session_endpoint) { return null }

    return config.end_session_endpoint
  }

  /**
   * Extracts and returns the `state` query or hash fragment param from a uri
   *
   * @param uri {string}
   * @param uriType {string} 'hash' or 'query'
   *
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

  /**
   * Loads a previously registered RP client for a given provider from storage,
   * or registers and saves one if none exists.
   *
   * @param providerUri {string}
   *
   * @return {Promise<RelyingParty>}
   */
  loadOrRegisterClient (providerUri) {
    this.currentClient = null

    return this.loadClient(providerUri)
      .then(loadedClient => {
        if (loadedClient) {
          this.currentClient = loadedClient
          return loadedClient
        } else {
          return this.registerClient(providerUri)
        }
      })
  }

  /**
   * Loads a previously registered RP client for a given provider from storage.
   *
   * @param providerUri {string}
   *
   * @return {Promise<RelyingParty>}
   */
  loadClient (providerUri) {
    if (!providerUri) {
      let error = new Error('Cannot load or register client, providerUri missing')
      return Promise.reject(error)
    }
    if (this.currentClient && this.currentClient.provider.url === providerUri) {
      // Client is cached, return it
      return Promise.resolve(this.currentClient)
    }

    // Check for client config stored locally
    let key = RP_BY_PROVIDER + providerUri
    let clientConfig = this.store.getItem(key)

    if (clientConfig) {
      clientConfig = JSON.parse(clientConfig)
      return RelyingParty.from(clientConfig)
    } else {
      return Promise.resolve(null)
    }
  }

  /**
   * Stores a RelyingParty client for a given provider in the local store.
   *
   * @param client {RelyingParty}
   * @param providerUri {string}
   */
  saveClient (client, providerUri) {
    this.currentClient = client
    this.store.setItem(RP_BY_PROVIDER + providerUri, client.serialize())
  }

  /**
   * Loads a provider's URI from store, given a `state` uri param.
   *
   * @param state {string}
   *
   * @return {string}
   */
  loadProviderByState (state) {
    let key = PROVIDER_BY_STATE + state
    let providerUri = this.store.getItem(key)
    return providerUri
  }

  /**
   * Resolves to the WebID URI of the current user. Intended to be triggered
   * when the user initiates login explicitly (such as by pressing a Login
   * button, etc).
   *
   * @param [providerUri] {string} Provider URI, result of a Provider Selection
   *   operation (that the app developer has provided). If `null`, the
   *   `selectProvider()` step will kick off its own UI for Provider Selection.
   *
   * @return {Promise<string>} Resolves to the logged in user's WebID URI
   */
  login (providerUri) {
    if (this.webId) {
      // Already logged in, or loaded from storage during instantiation
      return Promise.resolve(this.webId)
    }

    this.clearCurrentCredentials()

    return Promise.resolve(providerUri)
      .then(providerUri => this.selectProvider(providerUri))
      .then(selectedProviderUri => {
        if (selectedProviderUri) {
          return this.loadOrRegisterClient(selectedProviderUri)
        }
      })
      .then(client => {
        if (client) {
          return this.validateOrSendAuthRequest(client)
        }
      })
  }

  /**
   * Saves given user credentials in storage.
   *
   * @param {Object} options
   */
  saveCurrentCredentials (options) {
    this.setCurrentCredentials(options)
    this.store.setItem(CURRENT_CREDENTIALS, JSON.stringify(options))
  }

  /**
   * Initializes user credentials on the client instance.
   *
   * @param {Object} options
   */
  setCurrentCredentials (options) {
    this.webId = options.webId
    this.accessToken = options.accessToken
    this.idToken = options.idToken
  }

  /**
   * Clears current user credential from storage and client instance.
   * Used by logout(), etc.
   */
  clearCurrentCredentials () {
    this.store.removeItem(CURRENT_CREDENTIALS)

    this.webId = null
    this.accessToken = null
    this.idToken = null
  }

  /**
   * Clears the current user and tokens, and does a url redirect to the
   * current RP client's provider's 'end session' endpoint.
   * A redirect is done (instead of an ajax 'get') to enable the provider to
   * clear any http-only session cookies.
   */
  logout () {
    let logoutEndpoint = this.providerEndSessionEndpoint()

    this.clearCurrentCredentials()

    if (!logoutEndpoint) { return }

    let logoutUrl = new URL(logoutEndpoint)

    logoutUrl.searchParams.set('returnToUrl', this.currentLocation())

    this.redirectTo(logoutUrl.toString())
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
   *
   * @return {string|null}
   */
  selectProvider (providerUri) {
    providerUri = providerUri || this.currentProvider()

    if (providerUri) {
      return providerUri
    }

    // If not available, kick off a Select Provider popup window workflow
    this.selectProviderUI()
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

    if (!stateParam) { return null }

    let providerUri = this.loadProviderByState(stateParam)

    this.saveCurrentProvider(providerUri)

    return providerUri
  }

  /**
   * Opens a Select Provider popup window, initializes events.
   */
  selectProviderUI () {
    this.debug('Getting provider from default popup UI')
    this.initEventListeners(this.window)

    if (this.selectProviderWindow) {
      // Popup has already been opened
      this.selectProviderWindow.focus()
    } else {
      // Open a new Provider Select popup window
      this.selectProviderWindow = this.window.open('',
        'selectProviderWindow',
        'menubar=no,resizable=yes,width=300,height=300'
      )

      this.selectProviderWindow.document.write(providerSelectPopupSource)
      this.selectProviderWindow.document.close()
    }
  }

  /**
   * Tests whether the current URI is the result of an AuthenticationRequest
   * return redirect.
   *
   * @return {boolean}
   */
  currentUriHasAuthResponse () {
    let currentUri = this.currentLocation()
    let stateParam = this.extractState(currentUri, HASH)

    return !!stateParam
  }

  /**
   * Redirects the current window to the given uri.
   *
   * @param uri {string}
   */
  redirectTo (uri) {
    this.window.location.href = uri

    return false
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

    return client.createRequest(options, this.store)
      .then(authUri => {
        let state = this.extractState(authUri, QUERY)

        this.saveProviderByState(state, providerUri)

        return this.redirectTo(authUri)
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
   * user's ID Token and Access token, and returns the user's WebID
   *
   * @param client {RelyingParty}
   *
   * @throws {Error}
   *
   * @returns {Promise<string>} Current user's web id
   */
  initUserFromResponse (client) {
    let credentials = {}

    return client.validateResponse(this.currentLocation(), this.store)
      .then(response => {
        credentials.idToken = response.params.id_token
        credentials.accessToken = response.params.access_token

        this.clearAuthResponseFromUrl()

        return this.extractAndValidateWebId(response.decoded)
      })
      .then(webId => {
        credentials.webId = webId

        this.saveCurrentCredentials(credentials)

        return webId
      })
      .catch(error => {
        this.clearAuthResponseFromUrl()
        if (error.message === 'Cannot resolve signing key for ID Token.') {
          this.debug('ID Token found, but could not validate. Provider likely has changed their public keys. Please retry login.')
          return null
        } else {
          throw error
        }
      })
  }

  /**
   * @param idToken {IDToken}
   *
   * @throws {Error}
   *
   * @return {string}
   */
  extractAndValidateWebId (idToken) {
    let webId = idToken.payload.sub
    this.webId = webId
    return webId
  }

  /**
   * Removes authentication response data (access token, id token etc) from
   * the current url's hash fragment.
   */
  clearAuthResponseFromUrl () {
    let clearedUrl = this.currentLocationNoHash()

    this.replaceCurrentUrl(clearedUrl)
  }

  /**
   * Returns the current window URL without the hash fragment, or null if none
   * is available.
   *
   * @return {string|null}
   */
  currentLocationNoHash () {
    let currentLocation = this.currentLocation()
    if (!currentLocation) { return null }

    let currentUrl = new URL(this.currentLocation())
    currentUrl.hash = ''  // remove the hash fragment
    let clearedUrl = currentUrl.toString()

    return clearedUrl
  }

  /**
   * Replaces the current document's URL (used to clear the credentials in
   * the hash fragment after a redirect from the provider).
   *
   * @param newUrl {string}
   */
  replaceCurrentUrl (newUrl) {
    let history = this.window.history

    if (!history) { return }

    history.replaceState(history.state, history.title, newUrl)
  }

  /**
   * Registers and saves a relying party client.
   *
   * @param providerUri {string}
   * @param [options={}]
   * @param [options.redirectUri] {string} Defaults to window.location.href
   * @param [options.scope='openid profile'] {string}
   *
   * @throws {Error} If providerUri is missing
   *
   * @return {Promise<RelyingParty>} Registered RelyingParty client instance
   */
  registerClient (providerUri, options = {}) {
    return this.registerPublicClient(providerUri, options)
      .then(registeredClient => {
        this.saveClient(registeredClient, providerUri)
        return registeredClient
      })
  }

  /**
   * Registers a public RP client (public in the OAuth2 sense, one not capable
   * of storing its own `client_secret` securely, meaning a javascript web app,
   * a desktop or a mobile client).
   *
   * @private
   * @param providerUri {string}
   * @param [options={}]
   * @param [options.redirectUri] {string} Defaults to window.location.href
   * @param [options.scope='openid profile'] {string}
   *
   * @throws {Error} If providerUri is missing
   *
   * @return {Promise<RelyingParty>} Registered RelyingParty client instance
   */
  registerPublicClient (providerUri, options = {}) {
    this.debug('Registering public client...')
    if (!providerUri) {
      let error = new Error('Cannot registerClient auth client, missing providerUri')
      return Promise.reject(error)
    }

    let redirectUri = options.redirectUri || this.redirectUri || this.currentLocation()

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
      store: this.store
    }

    return this.registerRP(providerUri, registration, rpOptions)
  }

  /**
   * Performs the RP registration operation (discovers the provider settings,
   * loads its keys, makes the Dynamic Registration call).
   *
   * @param providerUri {string}
   * @param registration {Object}
   * @param rpOptions {Object}
   *
   * @return {RelyingParty}
   */
  registerRP (providerUri, registration, rpOptions) {
    return RelyingParty.register(providerUri, registration, rpOptions)
  }

  /**
   * Dispatches this app's window message events. Used by the Select Provider
   * popup to send events back to the main window.
   *
   * @param event
   */
  onMessage (event) {
    switch (event.data.event_type) {
      case 'providerSelected':
        this.providerSelected(event.data.value)

        break
      default:
        this.debug('onMessage - unknown event type: ', event)

        break
    }
  }

  /**
   * Dispatches the appropriate actions after the user selects a provider --
   * saves the provider uri, attempts to perform a login, and closes the Provider
   * Select window.
   *
   * @param providerUri {string}
   */
  providerSelected (providerUri) {
    this.debug('Provider selected: ', providerUri)

    this.saveCurrentProvider(providerUri)

    this.login(providerUri)

    this.selectProviderWindow.close()
  }

  /**
   * Saves a provider uri in storage for a given state parameter. Used to identify
   * which provider a callback redirect is from, afterwards.
   *
   * @param state {string}
   * @param providerUri {string}
   *
   * @throws {Error}
   */
  saveProviderByState (state, providerUri) {
    if (!state) {
      throw new Error('Cannot save providerUri - state not provided')
    }

    let key = PROVIDER_BY_STATE + state
    this.store.setItem(key, providerUri)
  }
}

ClientAuthOIDC.CURRENT_PROVIDER = CURRENT_PROVIDER
ClientAuthOIDC.CURRENT_CREDENTIALS = CURRENT_CREDENTIALS

module.exports = ClientAuthOIDC
