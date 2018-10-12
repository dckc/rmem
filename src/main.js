/* global require, module */

// @flow

const { docopt } = require('docopt');
const { Router } = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const connectSessionSequelize = require('connect-session-sequelize');

const { pages, render } = require('./views');

const urlencodedParser = bodyParser.urlencoded({ extended: false });
const def = Object.freeze;

const usage = `
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

`;


function main(argv, { fs, uuid4, express, Sequelize, session, csrf, bcrypt }) {
  const cli = docopt(usage, { argv: argv.slice(2) });
  console.log('CLI configuration:', argv, cli);

  const sequelize = new Sequelize(cli['--db'], {
    dialect: cli['--dialect'],
    logging: cli['--logging'],
  });
  const site = Site(sequelize, Sequelize);
  const agreements = Agreements(sequelize, Sequelize, {
    hash: bcrypt.hash,
    compare: bcrypt.compare,
  });

  if (cli.createdb) {
    site.createSchema(uuid4(), session);
    agreements.createSchema();
  } else if (cli.recapchaConfig) {
    fs.readFile(cli['--recaptcha-key'], 'utf8', recapchaConfig(site));
  } else if (cli.start) {
    const app = express();

    sequelize
      .authenticate()
      .then(() => {
        console.log('register: DB authenticated');

        site.getConfig('session.secret').then((secret) => {
          app.use(cookieParser());
          app.use(site.sessionMiddleware(session, secret));
          const reCAPTCHA = site.getConfig('reCAPTCHA').then(txt => JSON.parse(txt));
          agreements.router(csrf(), reCAPTCHA).then(r => app.use('/', r));
        });
      });

    const port = parseInt(cli['--port'], 10);
    app.listen(port, () => console.log(`Listening on port ${port}...`));
  }
}

function recapchaConfig(site) {
  return (err, data) => {
    if (err) { return console.log(err); }
    const { siteKey, secretKey } = JSON.parse(data);
    const missing = Object.entries({ siteKey, secretKey }).filter(([_, v]) => !v);
    if (missing.length > 0) {
      return console.error('reCAPTCHA config missing:', missing);
    }
    return site.setConfig('reCAPTCHA', JSON.stringify({ siteKey, secretKey }));
  };
}


/**
 * A Site has an app secret and a collections of sessions.
 *
 * ISSUE: TODO: prune expired sessions.
 */
function Site(sequelize, DTypes) {
  const Config = sequelize.define('config', {
    key: { type: DTypes.STRING, primaryKey: true },
    value: { type: DTypes.STRING },
  });

  function sessionStore(session) {
    const SequelizeStore = connectSessionSequelize(session.Store);

    return new SequelizeStore({ db: sequelize });
  }

  function sessionMiddleware(session, secret) {
    return session({
      secret,
      store: sessionStore(session),
      resave: false, // not needed when touch() is supported
      saveUninitialized: false,
      proxy: true, // ISSUE: if you do SSL outside of node.
    });
  }

  function createSchema(secret, session) /*: Promise<*> */ {
    return Promise.all([
      Config.sync(/* ISSUE: force? */)
        .then(() => Config.create({ key: 'session.secret', value: secret })),
      sessionStore(session).sync(/* ISSUE: force? */),
    ]);
  }

  function getConfig(key) {
    return Config.findById(key).then(record => record.value);
  }

  function setConfig(key, value) {
    return Config.upsert({ key, value });
  }

  return def({ createSchema, getConfig, setConfig, sessionMiddleware });
}


/**
 * Executing the membership agreement.
 */
function Agreements(sequelize, DTypes, { hash, compare }) {
  // ISSUE: record IP address?
  const fields = {
    // id
    firstName: { type: DTypes.STRING, allowNull: false },
    lastName: { type: DTypes.STRING, allowNull: false },
    email: { type: DTypes.STRING, allowNull: false, unique: true },
    companyName: { type: DTypes.STRING, allowNull: true },
    country: { type: DTypes.STRING, allowNull: false },
    minAge: { type: DTypes.ENUM, values: [18], allowNull: false },
    agreementRevised: { type: DTypes.DATEONLY, allowNull: false },
    passwordHash: { type: DTypes.STRING, allowNull: false },
    // createdAt, updatedAt
  };
  const Agreement = sequelize.define('agreement', fields);

  function createSchema() /*: Promise<void> */ {
    return Agreement.sync(/* ISSUE: force? */);
  }

  function page(tpl, extra) {
    return (req /*: express$Request */, res) => {
      // $FlowFixMe req.csrfToken
      res.send(render(tpl, { csrf: req.csrfToken(), ...pages, ...(extra || {}) }));
    };
  }

  function register(req /*: express$Request */, res, next) {
    const formData = { ...req.body };

    const { password, confirmPassword } = formData;
    if (password !== confirmPassword) {
      console.log('passwords do not match');
      return res.sendStatus(400);
    }

    const { info, missing } = validate({
      agreementRevised: pages.agreement.revisionDate,
      minAge: formData.verifiedYears ? 18 : '',
      passwordHash: formData.password,
      ...req.body,
    }, fields);
    if (missing.length > 0) {
      console.error(`fields ${JSON.stringify(missing)} required but not provided.`);
      return res.sendStatus(400); // ISSUE: form verification UI
    }

    const saltRounds = 10;
    return hash(password, saltRounds)
      .then(passwordHash => Agreement.create({ ...info, ...{ passwordHash } }))
      .then((agree) => {
        // $FlowFixMe property `user` is missing in `express$Request`
        req.user = info;
        res.send(`<p>Welcome, ${info.firstName}</p>`); // ISSUE: TODO: portal.
        // $FlowFixMe req.user
        console.log('new Agreement:', agree.id);
        return info;
      })
      .catch(oops => next(oops)); // ISSUE: form verification UI
  }

  function noRobots(secretKey) {
    return (req /*: express$Request */, _res, next) => {
      const formData = { ...req.body };
      const response = formData['g-recaptcha-response'];
      console.log('@@TODO: noRobots back-end callback', { secretKey, response });
      next();
    };
  }

  function userInfo(record) {
    const user = { ...record };
    delete user.passwordHash;
    return user;
  }

  function signIn(req /*: express$Request */, res, _next) {
    const { email, password } = { ...req.body };
    return Agreement.find({ where: { email } })
      .then((agreement) => {
        if (!agreement) { return res.sendStatus(403); }
        return compare(password, agreement.passwordHash)
          .then((ok) => {
            if (!ok) { return res.sendStatus(403); }
            // $FlowFixMe req.user
            req.user = userInfo(agreement.dataValues);
            res.send(`<p>Welcome back, ${req.user.firstName}</p>`); // ISSUE: TODO: portal.
            return agreement;
          });
      });
  }

  function router(csrfProtection, reCAPTCHA) {
    const it = Router();

    it.get(pages.index.path, csrfProtection, page(pages.index.text));
    it.get(pages.agreement.path, markdown(pages.agreement.text));

    // note csrfProtection has to go *after* urlencodedParser
    // ack dougwilson Feb 11, 2015
    // https://github.com/expressjs/csurf/issues/52#issuecomment-73981858
    it.post(pages.signIn.path, urlencodedParser, csrfProtection, signIn);

    return reCAPTCHA
      .then((config) => {
        console.log('reCAPTCHA config:', config);
        it.get(
          pages.register.path,
          csrfProtection,
          page(pages.register.text, { siteKey: config.siteKey }),
        );
        it.post(
          pages.register.path,
          urlencodedParser, csrfProtection, noRobots(config.secretKey),
          register,
        );
        return it;
      });
  }

  return def({ createSchema, router });
}


function validate(body, fields) {
  const info = { ...body };
  // Trim extra spaces; treat empty strings as missing data.
  Object.entries(info).forEach(([k, raw]) => {
    const refined = typeof raw === 'string' ? raw.trim() : raw;
    info[k] = refined === '' ? null : refined;
  });

  const missing = [];
  Object.keys(fields).forEach((f) => {
    if (!fields[f].allowNull && !info[f]) {
      missing.push(f);
    }
  });

  return { info, missing };
}


function markdown(text) {
  // ISSUE: markdown to HTML
  return (req/*: express$Request */, res) => res.type('text/plain').send(text);
}


if (require.main === module) {
  // Access ambient powers (clock, random, files, network)
  // only when invoked as main module.
  /* eslint-disable global-require */
  /* global process */
  main(process.argv, {
    fs: require('fs'),
    express: require('express'),
    Sequelize: require('sequelize'),
    uuid4: require('uuid4'),
    session: require('express-session'),
    csrf: require('csurf'),
    bcrypt: require('bcrypt'),
  });
}
