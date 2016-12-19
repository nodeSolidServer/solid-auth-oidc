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
    this.rp = null
    this.providerUri = null
  }

  keyByProvider () {
    return `oidc.rp.by-provider.${this.providerUri}`
  }

  keyByState () {
    return `oidc.rp.by-state.${this.state}`
  }

  get client () {
    // If one is already initialized, return it
    if (this.rp) {
      return this.rp
    }
    // Check to see if there's already a registered client in local storage
    if (this.providerUri) {
      return localStorage.getItem(this.keyByProvider())
    }
  }

  set client (rp) {
    this.rp = rp
    localStorage.setItem(this.keyByProvider(), rp.serialize())
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
  register (providerUri, options = {}) {
    return this.registerPublicClient(providerUri, options)
      .then(client => {
        this.rp = client
        localStorage.setItem('oidc.clients.'+providerUri, client.serialize())
        this.client_id = client.registration.client_id
        console.log('registered client:', client)
      })
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
    if (!providerUri) {
      throw TypeError('Cannot register auth client, missing providerUri')
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
}
module.exports = ClientAuthOIDC
