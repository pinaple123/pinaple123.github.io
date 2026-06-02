# Accounts + Admin console — setup (do this once)

The site now requires a login. Real accounts, banning, kicking, presence and the
admin console are powered by **Firebase** (Google's free backend). GitHub Pages
just serves the HTML; Firebase does the enforcement, so it can't be bypassed from
the browser's DevTools.

You have to create the free Firebase project yourself (the keys must be yours).
~10 minutes. Follow these steps in order.

## 1. Create the Firebase project
1. Go to https://console.firebase.google.com/ and sign in with a Google account.
2. **Add project** → name it anything (e.g. `games-site`) → you can disable Analytics → Create.

## 2. Turn on Email/Password sign-in
1. Left menu → **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Email/Password** → enable the top toggle → Save.

## 3. Create the Realtime Database
1. Left menu → **Build → Realtime Database → Create Database**.
2. Pick a location → start in **Locked mode** (we paste rules next) → Enable.

## 4. Paste the security rules
1. In Realtime Database → **Rules** tab.
2. Delete what's there, paste the entire contents of **`firebase-rules.json`** (in this repo), **Publish**.
   - These rules make `eric@taaplanning.com` permanently admin and stop anyone
     from making themselves admin, banning others, or reading other users.
   - If you want a different admin email, change it in **both** `firebase-rules.json`
     (3 places) **and** `index.html` (`ADMIN_EMAIL`), then re-publish + re-push.

## 5. Get your web config keys
1. Project settings (gear icon, top-left) → **General** → scroll to **Your apps**.
2. Click the **`</>`** (web) icon → register an app (nickname anything, skip Hosting).
3. It shows a `firebaseConfig = { ... }` block. Copy the values.

## 6. Paste the keys into the site
1. Open **`index.html`**, find the block marked `STEP 1 — PASTE YOUR FIREBASE CONFIG HERE`.
2. Replace the `PASTE_...` values with yours: `apiKey`, `authDomain`, `databaseURL`,
   `projectId`, `appId`. (Make sure `databaseURL` is the one ending in `-default-rtdb.firebaseio.com`.)
3. Save, commit, push.

## 7. First login = your admin account
1. Open the live site → **Create one** → sign up with **`eric@taaplanning.com`**.
2. That account is automatically admin → you'll see the gold **Admin** button.
3. Anyone else who signs up is a normal user, blocked from the 2nd site until you allow them.

---

## What the admin console does
- **Status / Last seen** — live online dot + how long ago each person was on.
- **2nd site** — per-user toggle for the "More Games" site (admins always allowed).
- **Ban / Unban** — banned users are logged out immediately and can't sign back in.
- **Kick** — forces that user to log out and reload (re-login required). Only works while online.
- **Make / Remove admin** — promote others to admin (they get the console too).

## Important caveat about the 2nd site
The "More Games" site (`aple.github.io` fork) is a **separate** GitHub Pages site.
The toggle here hides/blocks the button, but someone who already knows that site's
URL could still open it directly — this launcher can't lock another site's URL.
To *truly* lock the 2nd site, the same Firebase gate has to be added to that repo too.
Ask Claude to "add the login gate to the More Games fork" and it'll port it over.

## Costs
Firebase's free "Spark" plan covers this easily (small number of users, tiny data).
No credit card required.
