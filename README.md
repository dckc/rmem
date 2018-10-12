# RChain Membership (WIP)

app for becoming an RChain coop member

The initial approach is functional correctness and security.

Style and other aspects of UX are pending collaboration with designers
of rchain.coop.

## Sign Up (Register)

  - Provide contact info: name, email
    - Country
  - Password
    - stored using bcrypt
  - Execute membership agreement
    - at least 18 yrs old
    - ISSUE: privacy policy???
  - not a robot (reCAPTCHA; back-end TODO)

## Sign In

  - look up by email address
  - check password using bcrypt

## Payments (TODO)

## Installation

```
npm install
npm run createdb
```

Register with [My reCAPTCHA](https://www.google.com/recaptcha/admin).
Put the `siteKey` and `secretKey` in `recapcha-key.json` and run:

```
node src/main.js recapchaConfig
```

## Usage

```
npm start
```

## Usage Reference

```
Usage:
  main.js [options] createdb
  main.js [options] recapchaConfig
  main.js [options] start

Options:
 --db=URI               DB URI [default: sqlite:rchain-membership.db]
 --recaptcha-key=FILE   config file [default: recapcha-key.json]
 --dialect=NAME         DB dialect [default: sqlite]
 --port=N               HTTP port [default: 3000]
 --logging              log database statements
 -h --help              show usage
```
