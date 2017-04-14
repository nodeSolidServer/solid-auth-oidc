# solid-auth-oidc
[![](https://img.shields.io/badge/project-Solid-7C4DFF.svg?style=flat)](https://github.com/solid/solid)
[![NPM Version](https://img.shields.io/npm/v/solid-auth-oidc.svg?style=flat)](https://npm.im/solid-auth-oidc)

A Javascript authentication plugin for
[`solid-client`](https://github.com/solid/solid-client) based on OAuth2/OpenID
Connect.

This is an Authentication helper library that wraps an OpenID Connect (OIDC)
Relying Party library, [`oidc-rp`](https://github.com/anvilresearch/oidc-rp).
It is meant to be used in browser-side applications, as part of `solid-client`.

### Usage

##### currentUser

`Promise<string|null> currentUser()`

Resolves to the WebID URI of the currently authenticated user, or `null` if none
found.

This SHOULD be checked either on page load or on whatever "Application is
ready" event that your framework provides. For example:

```js
  // Using a standard "document loaded" event listener
  //  (equivalent to jQuery's $(document).ready())
  document.addEventListener('DOMContentLoaded', function () {
    solidClient.currentUser()
      .then(function (webId) {
        if (webId) {
          // User is logged in, you can display their webId, load their profile, etc
        } else {
          // Not logged in, display appropriate Login button / UI
        }
      })
      .catch(function (error) {
        // An error has occurred, display it to user
      })
  })
```

##### login

`Promise<string|null> login([string providerUri])`

This is the main "authenticate to your favorite server/identity provider"
action, which can be hooked up to whatever 'Login' button or link that your
UI provides.

App developers will use it in one of two ways:

a) (typical) Your app does not provide its own Select Provider UI, so you can
  just call `.login()` by itself with no parameter, which uses the built-in
  provider selection UI.
b) Your app *does* provide its own Select Provider UI. In this case, you can
  perform provider selection and pass in the `providerUri` to `.login()`
  directly.

Called by itself (without a `providerUri`), `login()` does the following:

1. If the user has already logged in, it resolves with their WebID URI
2. Otherwise, opens a 'Select Provider' popup window, asking the user to select
   their identity provider (Solid server, pod, etc) to login to.
3. The user makes their selection, and the popup closes and the current page
   is redirected to that provider's `/authorize` endpoint
4. When the user has gone through the local login process etc, they are
   redirected back to the current page (from which `login()` was invoked)

If `login()` is called *with* a `providerUri` argument, the Select Provider
popup window step is skipped, and the user proceeds directly to the auth
workflow.

```js
  // You can bind any sort of Login button or link to do the following:
  solidClient.login()
    .then(function (webId) {
      // User is logged in, you can display their webId, load their profile, etc
    })
    .catch(function (error) {
      // An error has occurred while logging in, display it to user
    })
```

After `login()` is successful, the following variables are set:

- `solidClient.auth.webId` is set to the current user's webId URI
- `solidClient.auth.accessToken` is set to the current user's access token

##### selectProvider

`Promise<string> selectProvider ([string providerUri])`

##### logout

`logout()`

Clears the current user and tokens, and does a url redirect to the current
RP client's provider's 'end session' endpoint. A redirect is done (instead of an
ajax 'get') to enable the provider to clear any http-only session cookies.
