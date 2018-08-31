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
const RelyingParty = require('@solid/oidc-rp')
const PoPToken = require('@solid/oidc-rp/lib/PoPToken')
const providerSelectPopupSource = require('./provider-select-popup')

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
   * @param [options.store=localStorage] Optionally inject localStorage
   */
  constructor (options = {}) {
    this.window = options.window || global.window
    this.store = options.store || global.localStorage

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
   *
   * @return {string|null}
   */
  currentLocation () {
    let window = this.window

    if (!window || !window.location) { return null }

    return window.location.href
  }

  /**
   * @return {Promise<string>} Resolves to current user's WebID URI
   */
  currentUser () {
    if (this.webId) {
      return Promise.resolve(this.webId)
    }

    // Attempt to find a provider based on the 'state' param of the current URI
    let providerUri = this.providerFromCurrentUri()

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

  keyByProvider (providerUri) {
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
          this.currentClient = null
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
    let clientConfig = this.store.getItem(key)

    if (clientConfig) {
      clientConfig = JSON.parse(clientConfig)
      return RelyingParty.from(clientConfig)
    } else {
      return Promise.resolve(null)
    }
  }

  /**
   * Loads a provider's URI from store, given a `state` uri param.
   * @param state {string}
   * @return {string}
   */
  loadProvider (state) {
    let key = this.keyByState(state)
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
    this.clearCurrentUser()

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

  clearCurrentUser () {
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
    this.clearCurrentUser()

    let logoutEndpoint = this.providerEndSessionEndpoint()

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
    console.log('Getting provider from default popup UI')
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
        if (!state) {
          throw new Error('Invalid authentication request uri')
        }
        this.saveProviderByState(state, providerUri)
        if (this.method === REDIRECT) {
          return this.redirectTo(authUri)
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

  issuePoPTokenFor (uri, session) {
    return PoPToken.issueFor(uri, session)
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
    return client.validateResponse(this.currentLocation(), this.store)
      .then(response => {
        this.idToken = response.authorization.id_token
        this.accessToken = response.authorization.access_token
        this.session = response

        this.clearAuthResponseFromUrl()

        return this.extractAndValidateWebId(response.idClaims.sub)
      })
      .catch(error => {
        this.clearAuthResponseFromUrl()
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
   *
   * @throws {Error}
   *
   * @return {string}
   */
  extractAndValidateWebId (idToken) {
    let webId = idToken
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

  currentLocationNoHash () {
    let currentLocation = this.currentLocation()
    if (!currentLocation) { return null }

    let currentUrl = new URL(this.currentLocation())
    currentUrl.hash = ''  // remove the hash fragment
    let clearedUrl = currentUrl.toString()

    return clearedUrl
  }

  replaceCurrentUrl (newUrl) {
    let history = this.window.history

    if (!history) { return }

    history.replaceState(history.state, history.title, newUrl)
  }

  /**
   * @param providerUri {string}
   * @param [options={}]
   * @param [options.redirectUri] {string} Defaults to window.location.href
   * @param [options.scope='openid profile'] {string}
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
      store: this.store
    }
    return RelyingParty
      .register(providerUri, registration, rpOptions)
  }

  onMessage (event) {
    console.log('Auth client received event: ', event)
    if (!event || !event.data) { return }
    switch (event.data.event_type) {
      case 'providerSelected':
        let providerUri = event.data.value
        console.log('Provider selected: ', providerUri)
        this.login(providerUri)
        this.selectProviderWindow.close()
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
    this.store.setItem(key, providerUri)
  }

  /**
   * Stores a RelyingParty client for a given provider in the local store.
   * @param client {RelyingParty}
   * @param providerUri {string}
   */
  storeClient (client, providerUri) {
    this.currentClient = client
    this.store.setItem(this.keyByProvider(providerUri), client.serialize())
  }
}

module.exports = ClientAuthOIDC
