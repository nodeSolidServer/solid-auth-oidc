'use strict'

global.URL = require('whatwg-url').URL
global.URLSearchParams = require('whatwg-url').URLSearchParams

const localStorage = require('localstorage-memory')

const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const chaiAsPromised = require('chai-as-promised')
chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(require('dirty-chai'))
chai.should()

const expect = chai.expect

const SolidAuthOIDC = require('../src/index')
const PoPToken = require('@solid/oidc-rp/lib/PoPToken')

describe('SolidAuthOIDC', () => {
  var auth
  const providerUri = 'https://provider.example.com'

  beforeEach(() => {
    localStorage.clear()
    auth = new SolidAuthOIDC({ window: { location: {} }, store: localStorage })
  })

  describe('login()', () => {
    it('should invoke selectProvider() if provider uri is not given', () => {
      let selectProvider = sinon.stub(auth, 'selectProvider').resolves(null)

      return auth.login()
        .then(() => {
          expect(selectProvider).to.have.been.called()
        })
    })

    it('should invoke selectProvider() with a given provider uri', () => {
      let selectProvider = sinon.stub(auth, 'selectProvider').resolves(null)

      return auth.login(providerUri)
        .then(() => {
          expect(selectProvider).to.have.been.calledWith(providerUri)
        })
    })

    it('should load a client for a given provider uri', () => {
      let loadOrRegisterClient = sinon.stub(auth, 'loadOrRegisterClient')
        .resolves(null)

      return auth.login(providerUri)
        .then(() => {
          expect(loadOrRegisterClient).to.have.been.calledWith(providerUri)
        })
    })

    it('should validate a loaded client for a given provider uri', () => {
      let mockClient = {}

      let loadOrRegisterClient = sinon.stub(auth, 'loadOrRegisterClient')
        .resolves(mockClient)

      let validateStub = sinon.stub(auth, 'validateOrSendAuthRequest')

      return auth.login(providerUri)
        .then(() => {
          expect(validateStub).to.have.been.calledWith(mockClient)
        })
    })
  })

  describe('logout()', () => {
    it('should clear the current user', () => {
      let clearCurrentUser = sinon.spy(auth, 'clearCurrentUser')

      auth.logout()
      expect(clearCurrentUser).to.have.been.called()
    })

    it('should not redirect if no current client exists', () => {
      let redirectTo = sinon.spy(auth, 'redirectTo')

      auth.logout()
      expect(redirectTo).to.not.have.been.called()
    })

    it('should redirect to the provider end session endpoint', () => {
      auth.window = { location: {} }

      let logoutEndpoint = 'https://example.com/logout'
      auth.providerEndSessionEndpoint = sinon.stub().returns(logoutEndpoint)

      let currentUrl = 'https://rp.com'
      auth.currentLocation = sinon.stub().returns(currentUrl)

      let redirectTo = sinon.spy(auth, 'redirectTo')

      auth.logout()

      expect(redirectTo)
        .to.have.been.calledWith('https://example.com/logout?returnToUrl=' +
          encodeURIComponent(currentUrl))
    })
  })

  describe('keyByState()', () => {
    it('should throw an error if no state param is passed to it', () => {
      let auth = new SolidAuthOIDC()

      expect(auth.keyByState).to.throw(/No state provided/)
    })

    it('should compose a key from the state param', () => {
      let auth = new SolidAuthOIDC()
      let key = auth.keyByState('abcd')

      expect(key).to.equal('oidc.rp.by-state.abcd')
    })
  })

  describe('providerFromCurrentUri()', () => {
    it('should return null when no state param present', () => {
      auth.window.location.href = 'https://client-app.example.com'
      let providerUri = auth.providerFromCurrentUri()

      expect(providerUri).to.not.exist()
    })

    it('should return null if no provider was saved', () => {
      let state = 'abcd'
      auth.window.location.href = `https://client-app.example.com#state=${state}`
      let loadedProviderUri = auth.providerFromCurrentUri()

      expect(loadedProviderUri).to.not.exist()
    })

    it('should load provider from current uri state param', () => {
      let providerUri = 'https://provider.example.com'
      let state = 'abcd'
      auth.saveProviderByState(state, providerUri)
      auth.window.location.href = `https://client-app.example.com#state=${state}`

      let loadedProviderUri = auth.providerFromCurrentUri()

      expect(loadedProviderUri).to.equal(providerUri)
    })
  })

  describe('provider persistence', () => {
    it('should store and load provider uri, by state', () => {
      let state = 'abcd'
      // Check to see that provider doesn't exist initially
      expect(auth.loadProvider(state)).to.not.exist()

      // Save the provider uri to local storage
      auth.saveProviderByState(state, providerUri)

      // Check that it was saved and can be loaded
      expect(auth.loadProvider(state)).to.equal(providerUri)
    })
  })

  describe('extractState()', () => {
    it('should return null when no uri is provided', () => {
      let state = auth.extractState()

      expect(state).to.not.exist()
    })

    it('should return null when uri has no query or hash fragment', () => {
      let state = auth.extractState('https://example.com')

      expect(state).to.not.exist()
    })

    it('should extract the state param from query fragments', () => {
      let uri = 'https://example.com?param1=value1&state=abcd'
      let state = auth.extractState(uri, 'query')

      expect(state).to.equal('abcd')

      uri = 'https://example.com?param1=value1'
      state = auth.extractState(uri, 'query')

      expect(state).to.not.exist()
    })

    it('should extract the state param from hash fragments', () => {
      let uri = 'https://example.com#param1=value1&state=abcd'
      let state = auth.extractState(uri)  // 'hash' is the default second param

      expect(state).to.equal('abcd')

      uri = 'https://example.com#param1=value1'
      state = auth.extractState(uri, 'hash')

      expect(state).to.not.exist()
    })
  })

  describe('selectProvider()', () => {
    it('should pass through a given providerUri', () => {
      expect(auth.selectProvider(providerUri)).to.eventually.equal(providerUri)
    })

    it('should derive a provider from the current uri', () => {
      auth.providerFromCurrentUri = sinon.stub().returns(providerUri)

      return auth.selectProvider()
        .then(selectedProvider => {
          expect(selectedProvider).to.equal(providerUri)
          expect(auth.providerFromCurrentUri).to.have.been.called()
        })
    })

    it('should obtain provider from UI, if not present or cached', () => {
      auth.providerFromCurrentUri = sinon.stub().returns(null)
      auth.providerFromUI = sinon.stub().resolves(providerUri)

      return auth.selectProvider()
        .then(selectedProvider => {
          expect(selectedProvider).to.equal(providerUri)
          expect(auth.providerFromUI).to.have.been.called()
        })
    })
  })

  describe('client persistence', () => {
    let clientConfig = { provider: { url: providerUri }}
    let mockClient = {
      provider: { url: providerUri },
      serialize: () => { return clientConfig }
    }

    describe('loadClient()', () => {
      it('should throw an error if no providerUri given', () => {
        expect(auth.loadClient()).to.be.rejected()
      })

      it('should return cached client if for the same provider', () => {
        auth.currentClient = mockClient

        expect(auth.loadClient(providerUri)).to.eventually.equal(mockClient)
      })

      it('should NOT return cached client if for different provider', () => {
        let providerUri = 'https://provider.example.com'
        auth.currentClient = {
          provider: { url: 'https://another.provider.com' }
        }

        expect(auth.loadClient(providerUri)).to.eventually.not.exist()
      })
    })

    it('should store and load serialized clients', () => {
      auth.storeClient(mockClient, providerUri)
      // Storing a client should cache it in the auth client
      expect(auth.currentClient).to.equal(mockClient)

      return auth.loadClient(providerUri)
        .then(loadedClient => {
          expect(loadedClient.provider.url).to.equal(providerUri)
        })
    })
  })

  describe('currentLocation()', () => {
    it('should return the current window uri', () => {
      localStorage.clear()

      let currentUri = 'https://client-app.example.com'
      let auth = new SolidAuthOIDC({
        window: { location: { href: currentUri } }, store: localStorage
      })

      expect(auth.currentLocation()).to.equal(currentUri)
    })
  })

  describe('validateOrSendAuthRequest()', () => {
    it('should throw an error when no client is given', () => {
      expect(auth.validateOrSendAuthRequest())
        .to.be.rejectedWith(/Could not load or register a RelyingParty client/)
    })

    it('should init user from auth response if present in current uri', () => {
      let state = 'abcd'
      auth.window.location.href = `https://client-app.example.com#state=${state}`
      let aliceWebId = 'https://alice.example.com/'
      let initUserFromResponseStub = sinon.stub().resolves(aliceWebId)
      auth.initUserFromResponse = initUserFromResponseStub
      let mockClient = {}

      return auth.validateOrSendAuthRequest(mockClient)
        .then(webId => {
          expect(webId).to.equal(aliceWebId)
          expect(initUserFromResponseStub).to.have.been.calledWith(mockClient)
        })
    })

    it('should send an auth request if no auth response in current uri', () => {
      let sendAuthRequestStub = sinon.stub().resolves(null)
      auth.sendAuthRequest = sendAuthRequestStub
      let mockClient = {}

      return auth.validateOrSendAuthRequest(mockClient)
        .then(() => {
          expect(sendAuthRequestStub).to.have.been.calledWith(mockClient)
        })
    })
  })

  describe('initUserFromResponse()', () => {
    it('should validate the auth response', () => {
      let aliceWebId = 'https://alice.example.com/'
      let authResponse = {
        authorization: {
          id_token: 'sample.id.token',
          access_token: 'sample.access.token'
        },
        idClaims: {
          sub: aliceWebId
        }
      }
      let validateResponseStub = sinon.stub().resolves(authResponse)
      let mockClient = {
        validateResponse: validateResponseStub
      }

      return auth.initUserFromResponse(mockClient)
        .then(webId => {
          expect(webId).to.equal(aliceWebId)
          expect(validateResponseStub).to.have.been.called()
        })
    })
  })

  describe('sendAuthRequest()', () => {
    it('should compose an auth request uri, save provider, and redirect', () => {
      let state = 'abcd'
      let providerUri = 'https://provider.example.com'
      let authUri = `https://provider.example.com/authorize?state=${state}`
      let createRequestStub = sinon.stub().resolves(authUri)
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
        })
    })
  })

  describe('currentUser()', () => {
    it('should return cached webId if present', () => {
      let aliceWebId = 'https://alice.example.com'
      auth.webId = aliceWebId

      expect(auth.currentUser()).to.eventually.equal(aliceWebId)
    })

    it('should return null if no cached webId and no current state param', () => {
      expect(auth.currentUser()).to.eventually.not.exist()
    })

    it('should automatically login if current uri has state param', () => {
      let state = 'abcd'
      let providerUri = 'https://provider.example.com'
      auth.saveProviderByState(state, providerUri)

      auth.window.location.href = `https://client-app.example.com#state=${state}`
      let aliceWebId = 'https://alice.example.com/'
      let loginStub = sinon.stub().resolves(aliceWebId)
      auth.login = loginStub

      return auth.currentUser()
        .then(webId => {
          expect(webId).to.equal(aliceWebId)
          expect(loginStub).to.have.been.calledWith(providerUri)
        })
    })
  })

  describe('providerEndSessionEndpoint()', () => {
    it('should return null if no current client', () => {
      auth.currentClient = null

      let url = auth.providerEndSessionEndpoint()

      expect(url).to.equal(null)
    })

    it('should return null if current client has no provider', () => {
      auth.currentClient = {}

      let url = auth.providerEndSessionEndpoint()

      expect(url).to.equal(null)
    })

    it('should return null if current provider has no configuration', () => {
      auth.currentClient = { provider: {} }

      let url = auth.providerEndSessionEndpoint()

      expect(url).to.equal(null)
    })

    it('should return null if current configuration has no end session endpoint', () => {
      auth.currentClient = { provider: { configuration: {} } }

      let url = auth.providerEndSessionEndpoint()

      expect(url).to.equal(null)
    })

    it('should return the provider end session endpoint', () => {
      auth.currentClient = {
        provider: {
          configuration: {
            'end_session_endpoint': 'https://example.com/logout'
          }
        }
      }

      let url = auth.providerEndSessionEndpoint()

      expect(url).to.equal('https://example.com/logout')
    })
  })

  describe('clearAuthResponseFromUrl()', () => {
    it('should replace the current url with a no-hash cleared one', () => {
      let clearedUrl = 'https://rp.com'

      auth.currentLocationNoHash = sinon.stub().returns(clearedUrl)
      auth.replaceCurrentUrl = sinon.stub()

      auth.clearAuthResponseFromUrl()

      expect(auth.replaceCurrentUrl).to.have.been.calledWith(clearedUrl)
    })
  })

  describe('replaceCurrentUrl()', () => {
    it('should do nothing if no window history present', () => {
      let auth = new SolidAuthOIDC()
      auth.window = {}

      expect(() => { auth.replaceCurrentUrl() }).to.not.throw()
    })

    it('should invoke replaceState() on window history with new url', () => {
      let auth = new SolidAuthOIDC()
      auth.window = {
        history: {
          replaceState: sinon.stub()
        }
      }

      let clearedUrl = 'https://example.com'
      auth.currentLocationNoHash = sinon.stub().returns(clearedUrl)

      auth.replaceCurrentUrl()
    })
  })

  describe('currentLocationNoHash()', () => {
    it('should return null if no current location', () => {
      let auth = new SolidAuthOIDC()

      let url = auth.currentLocationNoHash()

      expect(url).to.equal(null)
    })

    it('should return the current location with cleared hash fragment', () => {
      let auth = new SolidAuthOIDC()

      let currentUrl = 'https://example.com/#whatever'

      auth.currentLocation = sinon.stub().returns(currentUrl)

      let url = auth.currentLocationNoHash()

      expect(url).to.equal('https://example.com/')
    })
  })

  describe('issuePoPTokenFor()', () => {
    before(() => {
      sinon.stub(PoPToken, 'issueFor').resolves()
    })

    after(() => {
      PoPToken.issueFor.restore()
    })

    it('should invoke PoPToken.issueFor', () => {
      let auth = new SolidAuthOIDC()
      let uri = 'https://rs.com'
      let session = {}

      return auth.issuePoPTokenFor(uri, session)
        .then(() => {
          expect(PoPToken.issueFor).to.have.been.calledWith(uri, session)
        })
    })
  })
})
