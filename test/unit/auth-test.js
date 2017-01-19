'use strict'

describe('SolidAuthOIDC', () => {
  afterEach(done => {
    localStorage.clear()
    done()
  })

  describe('keyByState()', () => {
    it('should throw an error if no state param is passed to it', done => {
      let auth = new SolidAuthOIDC()
      try {
        auth.keyByState()
      } catch (err) {
        expect(err).to.exist
        done()
      }
    })

    it('should compose a key from the state param', done => {
      let auth = new SolidAuthOIDC()
      let key = auth.keyByState('abcd')
      expect(key).to.equal('oidc.rp.by-state.abcd')
      done()
    })
  })

  describe('provider persistence', () => {
    it('should store and load provider uri, by state', done => {
      let auth = new SolidAuthOIDC()
      let providerUri = 'https://provider.example.com'
      let state = 'abcd'
      // Check to see that provider doesn't exist initially
      expect(auth.loadProvider(state)).to.not.exist

      // Save the provider uri to local storage
      auth.saveProviderByState(state, providerUri)

      // Check that it was saved and can be loaded
      expect(auth.loadProvider(state)).to.equal(providerUri)
      done()
    })
  })

  describe('extractState()', () => {
    var auth
    beforeEach(done => {
      auth = new SolidAuthOIDC()
      done()
    })

    it('should return null when no uri is provided', done => {
      let state = auth.extractState()
      expect(state).to.not.exist
      done()
    })

    it('should return null when uri has no query or hash fragment', done => {
      let state = auth.extractState('https://example.com')
      expect(state).to.not.exist
      done()
    })

    it('should extract the state param from query fragments', done => {
      let uri = 'https://example.com?param1=value1&state=abcd'
      let state = auth.extractState(uri, 'query')
      expect(state).to.equal('abcd')

      uri = 'https://example.com?param1=value1'
      state = auth.extractState(uri, 'query')
      expect(state).to.not.exist
      done()
    })

    it('should extract the state param from hash fragments', done => {
      let uri = 'https://example.com#param1=value1&state=abcd'
      let state = auth.extractState(uri)  // 'hash' is the default second param
      expect(state).to.equal('abcd')

      uri = 'https://example.com#param1=value1'
      state = auth.extractState(uri, 'hash')
      expect(state).to.not.exist
      done()
    })
  })

  describe('providerFromCurrentUri()', () => {
    var auth
    beforeEach(done => {
      auth = new SolidAuthOIDC({ window: { location: {} } })
      done()
    })

    it('should return null when no state param present', done => {
      auth.window.location.href = 'https://client-app.example.com'
      let providerUri = auth.providerFromCurrentUri()
      expect(providerUri).to.not.exist
      done()
    })

    it('should return null if no provider was saved', done => {
      let state = 'abcd'
      auth.window.location.href = `https://client-app.example.com#state=${state}`
      let loadedProviderUri = auth.providerFromCurrentUri()
      expect(loadedProviderUri).to.not.exist
      done()
    })

    it('should load provider from current uri state param', done => {
      let providerUri = 'https://provider.example.com'
      let state = 'abcd'
      auth.saveProviderByState(state, providerUri)
      auth.window.location.href = `https://client-app.example.com#state=${state}`

      let loadedProviderUri = auth.providerFromCurrentUri()
      expect(loadedProviderUri).to.equal(providerUri)
      done()
    })
  })

  describe('selectProvider()', () => {
    it('should pass through a given providerUri', done => {
      let auth = new SolidAuthOIDC()
      let providerUri = 'https://provider.example.com'

      auth.selectProvider(providerUri)
        .then(selectedProvider => {
          assert.equal(selectedProvider, providerUri)
          done()
        })
        .catch(err => { console.error(err.message) })
    })

    it('should derive a provider from the current uri', done => {
      let auth = new SolidAuthOIDC()
      let providerUri = 'https://provider.example.com'
      auth.providerFromCurrentUri = sinon.stub().returns(providerUri)

      auth.selectProvider()
        .then(selectedProvider => {
          expect(selectedProvider).to.equal(providerUri)
          expect(auth.providerFromCurrentUri).to.have.been.called
          done()
        })
        .catch(err => { console.error(err.message) })
    })

    it('should obtain provider from UI, if not present or cached', done => {
      let auth = new SolidAuthOIDC()
      let providerUri = 'https://provider.example.com'
      auth.providerFromCurrentUri = sinon.stub().returns(null)
      auth.providerFromUI = sinon.stub().returns(Promise.resolve(providerUri))

      auth.selectProvider()
        .then(selectedProvider => {
          expect(selectedProvider).to.equal(providerUri)
          expect(auth.providerFromUI).to.have.been.called
          done()
        })
        .catch(err => { console.error(err.message) })
    })
  })

  describe('client persistence', () => {
    let providerUri = 'https://provider.example.com'
    let clientConfig = { provider: { url: providerUri }}
    let mockClient = {
      provider: { url: providerUri },
      serialize: () => { return clientConfig }
    }
    var auth
    beforeEach(done => {
      auth = new SolidAuthOIDC()
      done()
    })

    describe('loadClient()', () => {
      it('should throw an error if no providerUri given', done => {
        auth.loadClient()
          .catch(err => {
            expect(err).to.exist
            done()
          })
      })

      it('should return cached client if for the same provider', done => {
        auth.currentClient = mockClient
        auth.loadClient(providerUri)
          .then(cachedClient => {
            expect(cachedClient).to.equal(mockClient)
            done()
          })
          .catch(err => { console.error(err.message) })
      })

      it('should NOT return cached client if for different provider', done => {
        let providerUri = 'https://provider.example.com'
        auth.currentClient = {
          provider: { url: 'https://another.provider.com' }
        }
        auth.loadClient(providerUri)
          .then(loadedClient => {
            expect(loadedClient).to.not.exist
            done()
          })
          .catch(err => { console.error(err.message) })
      })
    })

    it('should store and load serialized clients', done => {
      let auth = new SolidAuthOIDC()

      auth.storeClient(mockClient, providerUri)
      // Storing a client should cache it in the auth client
      expect(auth.currentClient).to.equal(mockClient)

      auth.loadClient(providerUri)
        .then(loadedClient => {
          expect(loadedClient.provider.url).to.equal(providerUri)
          done()
        })
        .catch(err => { console.error(err.message) })
    })
  })

  describe('currentLocation()', () => {
    it('should return the current window uri', done => {
      let currentUri = 'https://client-app.example.com'
      let auth = new SolidAuthOIDC({ window: { location: { href: currentUri } } })
      expect(auth.currentLocation()).to.equal(currentUri)
      done()
    })
  })

  describe('validateOrSendAuthRequest()', () => {
    var auth
    beforeEach(done => {
      auth = new SolidAuthOIDC({ window: { location: {} } })
      done()
    })

    afterEach(done => {
      localStorage.clear()
      done()
    })

    it('should throw an error when no client is given', done => {
      auth.validateOrSendAuthRequest()
        .catch(err => {
          expect(err).to.exist
          done()
        })
    })

    it('should init user from auth response if present in current uri', done => {
      let state = 'abcd'
      auth.window.location.href = `https://client-app.example.com#state=${state}`
      let aliceWebId = 'https://alice.example.com/'
      let initUserFromResponseStub = sinon.stub().returns(Promise.resolve(aliceWebId))
      auth.initUserFromResponse = initUserFromResponseStub
      let mockClient = {}
      auth.validateOrSendAuthRequest(mockClient)
        .then(webId => {
          expect(webId).to.equal(aliceWebId)
          expect(initUserFromResponseStub).to.have.been.calledWith(mockClient)
          done()
        })
        .catch(err => { console.error(err.message) })
    })

    it('should send an auth request if no auth response in current uri', done => {
      let sendAuthRequestStub = sinon.stub().returns(Promise.resolve())
      auth.sendAuthRequest = sendAuthRequestStub
      let mockClient = {}
      auth.validateOrSendAuthRequest(mockClient)
        .then(() => {
          expect(sendAuthRequestStub).to.have.been.calledWith(mockClient)
          done()
        })
        .catch(err => { console.error(err.message) })
    })
  })

  describe('initUserFromResponse()', () => {
    var auth
    beforeEach(done => {
      auth = new SolidAuthOIDC({ window: { location: {} } })
      done()
    })

    afterEach(done => {
      localStorage.clear()
      done()
    })

    it('should validate the auth response', done => {
      let aliceWebId = 'https://alice.example.com/'
      let authResponse = {
        params: {
          id_token: 'sample.id.token',
          access_token: 'sample.access.token'
        },
        decoded: {
          payload: { sub: aliceWebId }
        }
      }
      let validateResponseStub = sinon.stub().returns(Promise.resolve(authResponse))
      let mockClient = {
        validateResponse: validateResponseStub
      }
      auth.initUserFromResponse(mockClient)
        .then(webId => {
          expect(webId).to.equal(aliceWebId)
          expect(validateResponseStub).to.have.been.called
          done()
        })
        .catch(err => { console.error(err.message) })
    })
  })

  describe('sendAuthRequest()', () => {
    it('should compose an auth request uri, save provider, and redirect', done => {
      let auth = new SolidAuthOIDC({ window: { location: {} } })
      let state = 'abcd'
      let providerUri = 'https://provider.example.com'
      let authUri = `https://provider.example.com/authorize?state=${state}`
      let createRequestStub = sinon.stub().returns(Promise.resolve(authUri))
      let mockClient = {
        provider: { url: providerUri },
        createRequest: createRequestStub
      }
      auth.sendAuthRequest(mockClient)
        .then(() => {
          // ensure providerUri was saved
          expect(auth.loadProvider(state)).to.equal(providerUri)
          // ensure the redirect happened
          expect(auth.currentLocation()).to.equal(authUri)
          done()
        })
        .catch(err => { console.error(err.message) })
    })
  })

  describe('currentUser()', () => {
    it('should return cached webId if present', done => {
      let aliceWebId = 'https://alice.example.com'
      let auth = new SolidAuthOIDC()
      auth.webId = aliceWebId

      auth.currentUser()
        .then(webId => {
          expect(webId).to.equal(aliceWebId)
          done()
        })
        .catch(err => { console.error(err.message) })
    })

    it('should return null if no cached webId and no current state param', done => {
      let auth = new SolidAuthOIDC({ window: { location: {} } })
      auth.currentUser()
        .then(webId => {
          expect(webId).to.not.exist
          done()
        })
        .catch(err => { console.error(err.message) })
    })

    it('should automatically login if current uri has state param', done => {
      let state = 'abcd'
      let providerUri = 'https://provider.example.com'
      let auth = new SolidAuthOIDC({ window: { location: {} } })
      auth.saveProviderByState(state, providerUri)

      auth.window.location.href = `https://client-app.example.com#state=${state}`
      let aliceWebId = 'https://alice.example.com/'
      let loginStub = sinon.stub().returns(Promise.resolve(aliceWebId))
      auth.login = loginStub

      auth.currentUser()
        .then(webId => {
          expect(webId).to.equal(aliceWebId)
          expect(loginStub).to.have.been.calledWith(providerUri)
          done()
        })
        .catch(err => { console.error(err.message) })
    })
  })
})
