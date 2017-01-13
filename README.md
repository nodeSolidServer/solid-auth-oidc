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

```js
  // Using a standard "document loaded" event listener
  //  (equivalent to jQuery's $(document).ready())
  // Trigger a login() check on page load, in case user is logged in already
  document.addEventListener('DOMContentLoaded', function () {
    SolidClient.auth.login()
      .then(function (webId) {
        // User is logged in, you can display their webId, load their profile, etc
        // Solid.auth.webId is set to the current user's webId URI
        // Also, SolidClient.auth.accessToken is set to the current user's access token
      })
      .catch(function (error) {
        // An error has occurred while logging in, display it to user
      })
  })
```

Called by itself, `login()` will perform Provider Discovery and kick off the
OAuth2/OpenID Connect `/authorize` process.
